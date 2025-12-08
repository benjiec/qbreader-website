import TossupClient from './TossupClient.js';

export default class TossupBonusClient extends TossupClient {
  constructor (room, userId, socket) {
    super(room, userId, socket);
  }

  onmessage (message) {
    const data = JSON.parse(message);
    switch (data.type) {
      default: return super.onmessage(message);
    }
  }
}
