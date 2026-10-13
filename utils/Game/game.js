class GameState {
  constructor({ x = 0, y = 0, speed = 0, direction = 0 } = {}) {
    this.x = x; this.y = y; this.speed = speed; this.direction = direction;
  }
}

class Game {
  constructor({
    startState, goalState, track,
    maxSpeed = 4, maxBraking = 1, maxAcceleration = 1,
    maxSteeringDeg = 15,
    goalRadius = 10,
  }) {
    Object.assign(this, { startState, goalState, track, maxSpeed, maxBraking,
                          maxAcceleration, maxSteeringDeg, goalRadius });
  }

  getStartState() { return this.startState; }
  getGoalState()  { return this.goalState; }

  isGoalState(s) {
    return Math.hypot(s.x - this.goalState.x, s.y - this.goalState.y) <= this.goalRadius;
  }

  isWallAt(x, y) {
    const row = this.track[y];
    if (row === undefined) return true;
    const c = row[x];
    return c === undefined || c === '0' || c === 0;
  }

  isWall(s) { return this.isWallAt(s.x, s.y); }
  isTerminalState(s) { return this.isGoalState(s) || this.isWall(s); }

  stateReward(s) {
    if (this.isGoalState(s)) return 1000;
    if (this.isWall(s)) return -100;
    return -1;
  }

  getAllowanceFactor(state){
    return Math.max(0.4, 1 - (state.speed / this.maxSpeed));
  }

  getLegalActions(state) {
    const actions = [];
    for (const steering of [-this.maxSteeringDeg * this.getAllowanceFactor(state), 0, this.maxSteeringDeg * this.getAllowanceFactor(state)]) {
      for (const acceleration of [-this.maxBraking, 0, this.maxAcceleration]) {
        actions.push({ steering, acceleration });
      }
    }
    return actions;
  }

  getNextState(state, action) {
    const direction = state.direction + (action.steering * Math.PI) / 180;
    const speed = Math.max(0, Math.min(this.maxSpeed, state.speed + action.acceleration));
    const steps = Math.max(1, Math.ceil(speed));
    let x = Math.floor(state.x), y = Math.floor(state.y);
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * speed;
      x = Math.round(state.x + t * Math.cos(direction));
      y = Math.round(state.y + t * Math.sin(direction));
      if (this.isWallAt(x, y) || Math.hypot(x - this.goalState.x, y - this.goalState.y) <= this.goalRadius) break;
    }
    return new GameState({ x, y, speed, direction });
  }
}

class Agent {
  constructor(game, {
    alpha = 0.2, gamma = 0.97,
    epsilon = 1.0, epsilonMin = 0.05, epsilonDecay = 0.9997,
    cellSize = 5, speedBuckets = 3, directionBuckets = 8,
    maxStepsPerEpisode = 400, progressWeight = 1,
  } = {}) {
    Object.assign(this, { 
      game, alpha, gamma, epsilon, epsilonMin, epsilonDecay,cellSize, speedBuckets, directionBuckets, maxStepsPerEpisode, progressWeight });
    this.qTable = new Map();
  }

  stateKey(s) {
    const sp = Math.min(this.speedBuckets - 1,
      Math.floor((s.speed / (this.game.maxSpeed + 1e-9)) * this.speedBuckets));
    const twoPi = 2 * Math.PI;
    const d = ((s.direction % twoPi) + twoPi) % twoPi;
    const db = Math.floor((d / twoPi) * this.directionBuckets) % this.directionBuckets;
    return `${Math.floor(s.x / this.cellSize)},${Math.floor(s.y / this.cellSize)},${sp},${db}`;
  }

  actionKey(a) { return `${a.steering},${a.acceleration}`; }

  getQ(sk, ak) { const r = this.qTable.get(sk); return r && r.has(ak) ? r.get(ak) : 0; }
  setQ(sk, ak, v) {
    if (!this.qTable.has(sk)) this.qTable.set(sk, new Map());
    this.qTable.get(sk).set(ak, v);
  }

  maxQ(s) {
    const sk = this.stateKey(s);
    let best = -Infinity;
    for (const a of this.game.getLegalActions(s)) best = Math.max(best, this.getQ(sk, this.actionKey(a)));
    return best === -Infinity ? 0 : best;
  }

  getBestAction(s) {
    const sk = this.stateKey(s);
    let best = -Infinity, pool = [];
    for (const a of this.game.getLegalActions(s)) {
      const q = this.getQ(sk, this.actionKey(a));
      if (q > best) { best = q; pool = [a]; } else if (q === best) pool.push(a);
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  chooseAction(s) {
    if (Math.random() < this.epsilon) {
      const acts = this.game.getLegalActions(s);
      return acts[Math.floor(Math.random() * acts.length)];
    }
    return this.getBestAction(s);
  }

  update(s, a, r, ns, done) {
    const sk = this.stateKey(s), ak = this.actionKey(a);
    const old = this.getQ(sk, ak);
    const target = done ? r : r + this.gamma * this.maxQ(ns);
    this.setQ(sk, ak, old + this.alpha * (target - old));
  }

  runEpisode() {
    let state = this.game.getStartState();
    const goal = this.game.getGoalState();
    const dist = s => Math.hypot(s.x - goal.x, s.y - goal.y);
    let total = 0, reachedGoal = false;

    for (let i = 0; i < this.maxStepsPerEpisode; i++) {
      const action = this.chooseAction(state);
      const next = this.game.getNextState(state, action);
      const done = this.game.isTerminalState(next);
      let r = this.game.stateReward(next);
      if (!done) r += this.progressWeight * (dist(state) - dist(next));

      this.update(state, action, r, next, done);
      total += r;
      state = next;
      if (done) { reachedGoal = this.game.isGoalState(next); break; }
    }
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
    return { total, reachedGoal };
  }

  async trainAsync(episodes, { chunk = 200, onProgress } = {}) {
    let wins = 0, sum = 0, n = 0;
    for (let ep = 1; ep <= episodes; ep++) {
      const { total, reachedGoal } = this.runEpisode();
      sum += total; n++; if (reachedGoal) wins++;
      if (ep % chunk === 0) {
        onProgress?.({ ep, avgReward: sum / n, successRate: wins / n, epsilon: this.epsilon });
        sum = 0; n = 0; wins = 0;
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }

  play() {
    let s = this.game.getStartState();
    const path = [s];
    for (let i = 0; i < this.maxStepsPerEpisode; i++) {
      s = this.game.getNextState(s, this.getBestAction(s));
      path.push(s);
      if (this.game.isTerminalState(s)) break;
    }
    return path;
  }
}

export { GameState, Game, Agent };