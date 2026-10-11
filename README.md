# PWG Chatroom

A responsive, cross-platform room chat. Run `npm install` then `npm start`; open http://localhost:3000. To chat across devices, deploy the whole folder to a Node.js host with WebSocket support and open its public HTTPS address on each device.

Rooms are created in memory and disappear when the server restarts. Messages are kept in memory for the lifetime of a room. This starter does not include accounts, encryption, or persistent storage; use it with people you trust and don't share sensitive information.
