require('colors');
const EventEmitter = require('events');
const OpenAI = require('openai');
const tools = require('../functions/function-manifest');
const { DbService } = require('./db-service');

// Import all functions included in function manifest
// Note: the function name and file name must be the same
const availableFunctions = {};
tools.forEach((tool) => {
  let functionName = tool.function.name;
  availableFunctions[functionName] = require(`../functions/${functionName}`);
});

class GptService extends EventEmitter {
  constructor() {
    super();
    this.openai = new OpenAI();
    this.dbService = new DbService();
    this.userContext = [
      { 'role': 'system', 'content': `You are a friendly and efficient virtual receptionist for a home services platform. Your role is to help customers connect with the right service professionals for their home repair needs. Follow these guidelines:

1. Be concise but thorough in understanding the issue
2. Always get specific details about:
   - What exactly is broken/not working
   - How long has it been an issue
   - Is it an emergency
   - Any relevant details about severity

3. Follow this conversation flow:
   - Get initial problem description
   - Ask 2-3 specific follow-up questions about the issue
   - Once you have enough details, ask for zip code
   - After zip code, check contractor availability
   - If they want to schedule, get preferred time and urgency
   
4. Response patterns:
   - Keep initial responses short: "What's happening with your [item]?"
   - Ask specific follow-ups: "Is it completely clogged or just draining slowly?"
   - For zip code: "What's your zip code?"
   - For scheduling: "When would you like the contractor to come? Is this urgent?"

5. Important rules:
   - Ask one clear question at a time
   - Get enough details to inform the contractor
   - Focus on severity and urgency
   - Keep responses under 15 words unless describing contractor availability` }
    ];
    this.partialResponseIndex = 0;
    this.conversationState = 'INITIAL';
    this.serviceType = null;
    this.detailsCollected = false;
  }

  setCallSid(callSid) {
    this.callSid = callSid;
  }

  validateFunctionArgs (args) {
    try {
      return JSON.parse(args);
    } catch (error) {
      console.log('Warning: Double function arguments returned by OpenAI:', args);
      // Seeing an error where sometimes we have two sets of args
      if (args.indexOf('{') != args.lastIndexOf('{')) {
        return JSON.parse(args.substring(args.indexOf(''), args.indexOf('}') + 1));
      }
    }
  }

  updateUserContext(name, role, text) {
    if (name !== 'user') {
      this.userContext.push({ 'role': role, 'name': name, 'content': text });
    } else {
      this.userContext.push({ 'role': role, 'content': text });
    }
  }

  determineServiceType(text) {
    const serviceKeywords = {
      plumbing: ['toilet', 'sink', 'pipe', 'drain', 'faucet', 'plumb', 'water', 'bathroom'],
      electrical: ['electric', 'power', 'light', 'outlet', 'switch', 'wire'],
      hvac: ['heat', 'air', 'ac', 'furnace', 'hvac', 'cooling', 'temperature'],
      general: ['wall', 'ceiling', 'repair', 'fix', 'broken', 'maintenance', 'damage', 'hole', 'crack']
    };

    text = text.toLowerCase();
    for (const [type, keywords] of Object.entries(serviceKeywords)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return type;
      }
    }
    return null;
  }

  async handleZipCode(zipCode) {
    if (!this.serviceType) {
      return {
        found: false,
        message: "I need to understand what service you need first. What's the issue?"
      };
    }

    try {
      const result = await this.dbService.findAvailableContractor(zipCode, this.serviceType);
      if (result.found) {
        return {
          found: true,
          message: `Perfect! ${result.contractor.name} from ${result.contractor.company_name} specializes in ${this.serviceType} issues. Would you like to schedule an appointment?`
        };
      } else {
        return {
          found: false,
          message: "I apologize, but I don't have any contractors available in your area right now."
        };
      }
    } catch (error) {
      console.error('Database error:', error);
      return {
        found: false,
        message: "I'm having trouble checking availability. Could you try your zip code again?"
      };
    }
  }

  async completion(text, interactionCount, role = 'user', name = 'user') {
    console.log('DEBUG: GPT completion started with text:', text);
    
    // Update context first
    this.updateUserContext(name, role, text);
    
    // Check for zip code first
    const zipMatch = text.match(/\b\d{5}\b/);
    if (zipMatch && this.serviceType && this.detailsCollected) {
      const result = await this.handleZipCode(zipMatch[0]);
      this.emit('gptreply', {
        partialResponseIndex: this.partialResponseIndex++,
        partialResponse: result.message
      }, interactionCount);
      return;
    }

    // Check for scheduling response
    const yesPattern = /(yes|yeah|sure|okay|yep|yup|definitely|absolutely|please)/i;
    const noPattern = /(no|nah|nope|not|don't)/i;
    const lastMsg = this.userContext.slice(-2)[0]?.content || '';
    
    if (lastMsg.includes('schedule an appointment')) {
      if (text.match(yesPattern)) {
        this.emit('gptreply', {
          partialResponseIndex: this.partialResponseIndex++,
          partialResponse: "When would you prefer the contractor to come? And is this an urgent matter?"
        }, interactionCount);
        return;
      } else if (text.match(noPattern)) {
        this.emit('gptreply', {
          partialResponseIndex: this.partialResponseIndex++,
          partialResponse: "No problem. Please call back when you'd like to schedule."
        }, interactionCount);
        return;
      }
    }

    // Determine service type if not already set
    if (!this.serviceType) {
      this.serviceType = this.determineServiceType(text);
    }

    try {
      // If we have service type but not enough details
      if (this.serviceType && !this.detailsCollected) {
        const stream = await this.openai.chat.completions.create({
          model: 'gpt-4-1106-preview',
          messages: [
            ...this.userContext,
            { role: 'system', content: 'Ask ONE specific follow-up question about their issue. Focus on severity, urgency, or duration of the problem.' }
          ],
          temperature: 0.7,
          stream: true,
        });

        let completeResponse = '';
        let partialResponse = '';

        for await (const chunk of stream) {
          let content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            completeResponse += content;
            partialResponse += content;
            
            if (partialResponse.includes('?')) {
              this.emit('gptreply', {
                partialResponseIndex: this.partialResponseIndex,
                partialResponse
              }, interactionCount);
              this.partialResponseIndex++;
              break;
            }
          }
        }

        // If we've gotten enough details, mark it
        if (this.userContext.length >= 4) {
          this.detailsCollected = true;
          this.emit('gptreply', {
            partialResponseIndex: this.partialResponseIndex++,
            partialResponse: "What's your zip code?"
          }, interactionCount);
        }

        this.userContext.push({'role': 'assistant', 'content': completeResponse});
        return;
      }

      // If we need zip code
      if (this.serviceType && this.detailsCollected && !zipMatch) {
        this.emit('gptreply', {
          partialResponseIndex: this.partialResponseIndex++,
          partialResponse: "What's your zip code?"
        }, interactionCount);
        return;
      }

      // Initial problem understanding
      const stream = await this.openai.chat.completions.create({
        model: 'gpt-4-1106-preview',
        messages: [
          ...this.userContext,
          { role: 'system', content: 'Ask a specific question about their problem. Focus on what exactly is wrong.' }
        ],
        temperature: 0.7,
        stream: true,
      });

      let completeResponse = '';
      let partialResponse = '';

      for await (const chunk of stream) {
        let content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          completeResponse += content;
          partialResponse += content;
          
          if (partialResponse.includes('?')) {
            this.emit('gptreply', {
              partialResponseIndex: this.partialResponseIndex,
              partialResponse
            }, interactionCount);
            this.partialResponseIndex++;
            break;
          }
        }
      }

      this.userContext.push({'role': 'assistant', 'content': completeResponse});
    } catch (error) {
      console.error('Error in GPT stream:', error);
      this.emit('gptreply', {
        partialResponseIndex: this.partialResponseIndex,
        partialResponse: "Could you repeat that?"
      }, interactionCount);
      this.partialResponseIndex++;
    }
  }
}

module.exports = { GptService };
