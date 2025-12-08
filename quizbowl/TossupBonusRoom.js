import TossupRoom from './TossupRoom.js';

export default class TossupBonusRoom extends TossupRoom {
  constructor (name, categories = [], subcategories = [], alternateSubcategories = []) {
    super(name, categories, subcategories, alternateSubcategories);
  }

  async message (userId, message) {
    switch (message.type) {
      default: return super.message(userId, message);
    }
  }
}
