require('dotenv').config();
require('colors');

const express = require('express');
const ExpressWs = require('express-ws');

const { GptService } = require('./services/gpt-service');
const { StreamService } = require('./services/stream-service');
const { TranscriptionService } = require('./services/transcription-service');
const { TextToSpeechService } = require('./services/tts-service');

const VoiceResponse = require('twilio').twiml.VoiceResponse;

const app = express();
ExpressWs(app);

const PORT = process.env.PORT || 3000;

// Constants for conversation handling
const SILENCE_THRESHOLD = 35; // Reduced for faster response
const MIN_SPEECH_LENGTH = 3;  // Keep minimum speech length low
const MAX_SILENCE_TIME = 800; // Reduced wait time for faster processing
const ACK_COOLDOWN = 300; // Much shorter cooldown for faster acknowledgments
const MAX_ACKS_PER_UTTERANCE = 1; // Limit acknowledgments per utterance

// Quick acknowledgments to reduce perceived latency
const ACKNOWLEDGMENTS = [
  "Got it.",
  "Okay.",
  "I see.",
];

// Track active connections
const activeConnections = new Set();

// Cleanup function for connections
const cleanupConnection = (ws) => {
  activeConnections.delete(ws);
  if (ws.silenceTimer) {
    clearTimeout(ws.silenceTimer);
  }
  ws.terminate();
};

app.post('/incoming', (req, res) => {
  const response = new VoiceResponse();
  const connect = response.connect();
  connect.stream({ url: `wss://${process.env.SERVER}/connection` });
  
  res.type('text/xml');
  res.send(response.toString());
});

app.ws('/connection', (ws) => {
  // Add connection to active set
  activeConnections.add(ws);

  // Initialize connection state
  const connectionState = {
    streamSid: null,
    callSid: null,
    lastSpeechTimestamp: Date.now(),
    lastAckTimestamp: 0,
    silenceTimer: null,
    processingResponse: false,
    currentSpeech: '',
    interactionCount: 0,
    currentUtteranceAcks: 0
  };

  // Initialize services
  const gptService = new GptService();
  const streamService = new StreamService(ws);
  const transcriptionService = new TranscriptionService();
  const ttsService = new TextToSpeechService({});

  const handleSilence = () => {
    if (connectionState.currentSpeech && 
        connectionState.currentSpeech.length >= MIN_SPEECH_LENGTH) {
      transcriptionService.emit('transcription', connectionState.currentSpeech);
      connectionState.currentSpeech = '';
      connectionState.currentUtteranceAcks = 0;
    }
  };

  // Handle incoming WebSocket messages
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.event) {
        case 'start':
          connectionState.streamSid = msg.start.streamSid;
          connectionState.callSid = msg.start.callSid;
          
          streamService.setStreamSid(connectionState.streamSid);
          gptService.setCallSid(connectionState.callSid);

          // Initial greeting
          ttsService.generate({
            partialResponseIndex: null,
            partialResponse: 'Hello! How can I help you with your home service needs today?'
          }, 0);
          break;

        case 'media':
          connectionState.lastSpeechTimestamp = Date.now();
          
          // Clear existing silence timer
          if (connectionState.silenceTimer) {
            clearTimeout(connectionState.silenceTimer);
          }

          // Set new silence timer
          connectionState.silenceTimer = setTimeout(handleSilence, MAX_SILENCE_TIME);
          
          transcriptionService.send(msg.media.payload);
          break;

        case 'mark':
          console.log(`Audio mark completed: ${msg.mark.name}`);
          break;

        case 'stop':
          console.log(`Media stream ${connectionState.streamSid} ended.`);
          cleanupConnection(ws);
          break;
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  // Handle speech detection
  transcriptionService.on('utterance', (text) => {
    if (text && text.length >= MIN_SPEECH_LENGTH) {
      connectionState.currentSpeech = text;
      connectionState.lastSpeechTimestamp = Date.now();

      // Send quick acknowledgment
      const now = Date.now();
      if (!connectionState.processingResponse && 
          connectionState.currentUtteranceAcks < MAX_ACKS_PER_UTTERANCE && 
          (now - connectionState.lastAckTimestamp > ACK_COOLDOWN)) {
        const ack = ACKNOWLEDGMENTS[Math.floor(Math.random() * ACKNOWLEDGMENTS.length)];
        ttsService.generate({
          partialResponseIndex: null,
          partialResponse: ack
        }, connectionState.interactionCount);
        connectionState.lastAckTimestamp = now;
        connectionState.currentUtteranceAcks++;
      }
    }
  });

  // Handle complete transcriptions
  transcriptionService.on('transcription', async (text) => {
    if (!text || connectionState.processingResponse || text.length < MIN_SPEECH_LENGTH) {
      return;
    }

    connectionState.processingResponse = true;
    connectionState.currentUtteranceAcks = 0;
    console.log(`Processing: ${text}`);

    try {
      await gptService.completion(text, connectionState.interactionCount);
      connectionState.interactionCount++;
    } catch (error) {
      console.error('Error processing speech:', error);
    } finally {
      connectionState.processingResponse = false;
      connectionState.currentSpeech = '';
    }
  });

  // Handle GPT responses
  gptService.on('gptreply', async (gptReply, icount) => {
    ttsService.generate(gptReply, icount);
  });

  // Handle text-to-speech generation
  ttsService.on('speech', (responseIndex, audio, label, icount) => {
    streamService.buffer(responseIndex, audio);
  });

  // Handle connection errors and closure
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    cleanupConnection(ws);
  });

  ws.on('close', () => {
    console.log(`Connection closed for ${connectionState.streamSid}`);
    cleanupConnection(ws);
  });
});

// Handle process termination
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Cleaning up connections...');
  activeConnections.forEach(cleanupConnection);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT. Cleaning up connections...');
  activeConnections.forEach(cleanupConnection);
  process.exit(0);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
});

module.exports = { app, server };
