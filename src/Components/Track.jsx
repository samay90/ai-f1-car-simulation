import { useEffect, useRef, useState } from "react";
import { Game, GameState, Agent } from "../../utils/Game/game";
import PlayGame from "./Game";
import terminals from "../../generator/terminals.json"

export default function Track({ track }) {
  const [agent, setAgent] = useState(null);
  const [progress, setProgress] = useState(null);
  const [training, setTraining] = useState(false);
  const startTraining = async () => {
    const start = terminals.start;
    const finish = terminals.finish;
    const g = new Game({
      startState: new GameState({ x: start[0], y: start[1]}),
      goalState:  new GameState({ x: finish[0], y: finish[1]}),
      track,
    });
    const a = new Agent(g, {
      epsilonDecay: 0.9997
    });
    setAgent(a);          // show the game right away, AI trains in the background
    setTraining(true);
    const T = 500000
    await a.trainAsync(T, { onProgress: setProgress });
    setTraining(false);
  };

  return (
    <div>
      <button onClick={startTraining} disabled={training}>
        {training ? "Training..." : "Train AI"}
      </button>
      {progress && (
        <p>
          Episode {progress.ep} · success {(progress.successRate * 100).toFixed(0)}% ·
          epsilon {progress.epsilon.toFixed(2)}
        </p>
      )}
      {agent && <PlayGame game={agent.game} agent={agent} />}
    </div>
  );
}