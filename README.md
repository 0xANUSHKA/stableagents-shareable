# AI Home Services Virtual Receptionist

## Overview
An intelligent virtual receptionist system that connects homeowners with service professionals through natural voice conversations. The system uses advanced AI to understand home repair needs, collect relevant details, and seamlessly match customers with available contractors.

## Key Features
- Real-time voice interaction using WebSocket communication
- Natural language processing powered by GPT-4
- Smart service type detection (plumbing, electrical, HVAC, general repairs)
- Structured conversation flow for gathering repair details
- Automated contractor matching based on service type and location
- Appointment scheduling capabilities
- Intelligent silence handling and conversation management

## Tech Stack
- **Backend**: Node.js + Express
- **AI/ML**: OpenAI GPT-4
- **Voice Processing**: Text-to-Speech & Speech-to-Text services
- **Communication**: WebSocket, Twilio Integration
- **Architecture**: Event-driven with modular services

## Getting Started
1. Set up environment variables in `.env`
2. Install dependencies: `npm install`
3. Start the server: `npm start`

## Environment Variables Required
