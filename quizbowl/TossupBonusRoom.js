import { ANSWER_TIME_LIMIT, BONUS_PROGRESS_ENUM } from './constants.js';
import TossupRoom from './TossupRoom.js';

const ROUND = Object.freeze({
  TOSSUP: 0,
  BONUS: 1
});

export default class TossupBonusRoom extends TossupRoom {
  constructor (name, categories = [], subcategories = [], alternateSubcategories = []) {
    super(name, categories, subcategories, alternateSubcategories);
    this.currentRound = ROUND.TOSSUP;
    this.useRandomQuestionCache = false;
  }

  switchToTossupRound () {
    this.currentRound = ROUND.TOSSUP;
    this.getNextLocalQuestion = super.getNextLocalQuestion;
    this.getRandomQuestions = this.getRandomTossups;
  }

  switchToBonusRound() {
    this.currentRound = ROUND.BONUS;

    this.getNextLocalQuestion = () => {
      if (this.localQuestions.bonuses.length === 0) { return null; }
      if (this.settings.randomizeOrder) {
        const randomIndex = Math.floor(Math.random() * this.localQuestions.bonuses.length);
        return this.localQuestions.bonuses.splice(randomIndex, 1)[0];
      }
      return this.localQuestions.bonuses.shift();
    };
    console.log("switching to getRandomBonuses");
    this.getRandomQuestions = this.getRandomBonuses;

    this.bonus = {};
    this.bonusProgress = BONUS_PROGRESS_ENUM.NOT_STARTED;
    /**
     * 0-indexed variable that tracks current part of the bonus being read
     */
    this.currentPartNumber = -1;
    /**
     * tracks how well the team is doing on the bonus
     * @type {number[]}
     */
    this.pointsPerPart = [];

    this.query = {
      threePartBonuses: true,
      ...this.query
    };
  }

  async message (userId, message) {
    switch (message.type) {
      case 'give-answer': return this.giveAnswer(userId, message);
      case 'start-answer': return this.startAnswer(userId, message);
      default: return super.message(userId, message);
    }
  }

  scoreTossup ({ givenAnswer }) {
    const decision = super.scoreTossup({ givenAnswer });
    console.log("scoreTossup returns", decision);
    if (decision.directive === "accept") {
      console.log("switching to Bonus round");
      this.switchToBonusRound();
    }
    return decision;
  }

  async nextRound (userId, { type }) {
    if (this.currentRound === ROUND.TOSSUP) {
      console.log("next Tossup question");
      await this.nextTossup(userId, { type });
    }
    else {
      console.log("next Bonus question");
      await this.nextBonus(userId, { type });
    }
  }

  async nextBonus (userId, { type }) {
    if (this.queryingQuestion) { return false; }
    if (this.bonusProgress === BONUS_PROGRESS_ENUM.READING && !this.settings.skip) { return false; }

    clearInterval(this.timer.interval);
    this.emitMessage({ type: 'timer-update', timeRemaining: 0 });

    const bonusStarted = this.bonusProgress !== BONUS_PROGRESS_ENUM.NOT_STARTED;
    const lastPartRevealed = this.bonusProgress === BONUS_PROGRESS_ENUM.LAST_PART_REVEALED;
    const pointsPerPart = this.pointsPerPart;

    if (type === 'next' && bonusStarted) {
      console.log("skipping this bonus, switch to Tossup round");
      this.players[userId].updateStats(this.pointsPerPart.reduce((a, b) => a + b, 0), 1);
      this.switchToTossupRound();
      await this.nextTossup(userId, { type });
    }
    else {
      const oldBonus = this.bonus;
      this.bonus = await this.advanceQuestion();
      this.queryingQuestion = false;
      if (!this.bonus) {
        this.emitMessage({ type: 'end', lastPartRevealed, oldBonus, pointsPerPart, stats, userId });
        return false;
      }

      this.emitMessage({ type, bonus: this.bonus, lastPartRevealed, oldBonus, packetLength: this.packetLength, pointsPerPart });
      console.log("start a new bonus question", this.bonus);

      this.currentPartNumber = -1;
      this.pointsPerPart = [];
      this.bonusProgress = BONUS_PROGRESS_ENUM.READING;
      this.revealLeadin();
      this.revealNextPart();
    }
  }

  giveAnswer (userId, { givenAnswer }) {
    if (this.currentRound === ROUND.TOSSUP) {
      return super.giveAnswer(userId, { givenAnswer });
    }

    if (typeof givenAnswer !== 'string') { return false; }

    this.liveAnswer = '';
    clearInterval(this.timer.interval);
    this.emitMessage({ type: 'timer-update', timeRemaining: ANSWER_TIME_LIMIT * 10 });

    const { directive, directedPrompt } = this.checkAnswer(this.bonus.answers[this.currentPartNumber], givenAnswer);
    this.emitMessage({ type: 'give-answer', currentPartNumber: this.currentPartNumber, directive, directedPrompt, userId });

    if (directive === 'prompt') {
      this.startServerTimer(
        ANSWER_TIME_LIMIT * 10,
        (time) => this.emitMessage({ type: 'timer-update', timeRemaining: time }),
        () => this.giveAnswer(userId, { givenAnswer: this.liveAnswer })
      );
    } else {
      this.pointsPerPart.push(directive === 'accept' ? this.getPartValue() : 0);
      this.revealNextAnswer();
      this.revealNextPart();
    }
  }

  startAnswer (userId) {
    this.emitMessage({ type: 'start-answer', userId });
    this.startServerTimer(
      ANSWER_TIME_LIMIT * 10,
      (time) => this.emitMessage({ type: 'timer-update', timeRemaining: time }),
      () => this.giveAnswer(userId, { givenAnswer: this.liveAnswer })
    );
  }

  getPartValue (partNumber = this.currentPartNumber) {
    return this.bonus?.values?.[this.currentPartNumber] ?? 10;
  }

  revealLeadin () {
    this.emitMessage({ type: 'reveal-leadin', leadin: this.bonus.leadin });
  }

  revealNextAnswer () {
    const lastPartRevealed = this.currentPartNumber === this.bonus.parts.length - 1;
    if (lastPartRevealed) {
      this.bonusProgress = BONUS_PROGRESS_ENUM.LAST_PART_REVEALED;
    }
    this.emitMessage({
      type: 'reveal-next-answer',
      answer: this.bonus.answers[this.currentPartNumber],
      currentPartNumber: this.currentPartNumber,
      lastPartRevealed
    });
  }

  revealNextPart () {
    if (this.bonusProgress === BONUS_PROGRESS_ENUM.LAST_PART_REVEALED) { return; }

    this.currentPartNumber++;
    this.emitMessage({
      type: 'reveal-next-part',
      currentPartNumber: this.currentPartNumber,
      part: this.bonus.parts[this.currentPartNumber],
      value: this.getPartValue()
    });
  }
}
