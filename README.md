# StoryForge

A multi-agent narrative simulation engine with epistemic isolation and SAE-ready session tracking.

**This is NOT a game engine.** It's a dramaturgical OS for running agents through storyworld JSON schemas with enforced epistemic partitions.

It is designed to be embedded into game engine frameworks where inter-agent communication is part of the game.

## Core Concepts

### Storyworld-Mediated Interaction

Agents interact through **narrative structures**:

- **Spools**: Narrative arcs/threads they can enter and progress through
- **Encounters**: Discrete moments with choices and consequences
- **Variables**: World state that gates control and choices mutate
- **Gates**: Predicates that control narrative flow

### Epistemic Isolation

Each agent has their own **AgentView** - an isolated snapshot of what they can see:

```typescript
interface AgentView {
  agentId: string;
  frame: number;
  visibleVariables: VariableState[];    // Only what they can see
  availableSpools: SpoolInfo[];          // Narrative options
  currentEncounter?: Encounter;          // Where they are
  availableChoices: Choice[];            // What they can do
  // NO access to other agents' views
}
```

This prevents:
- Cross-agent backchanneling
- Shared context window exploitation
- Emergent coordination through model introspection

### Session Tracking for SAE

Every playthrough is logged as a **SessionOutcome** with:

```typescript
interface SessionOutcome {
  sessionId: string;
  agentId: string;
  choiceSequence: {
    frame: number;
    encounterId: string;
    choiceId: string;
    availableChoices: string[];  // What else could they have chosen
    choiceIndex: number;          // Position in list
  }[];
  endingsReached: string[];
  // ... metrics for analysis
}
```

This enables:
- Cross-session behavioral analysis
- Choice distribution tracking
- SAE feature extraction
- Agent profile aggregation

## Architecture

```
storyforge/
├── src/
│   ├── core/
│   │   ├── types.ts      # Simulation, Frame, Agent, Event
│   │   └── engine.ts     # SimulationEngine with epistemic isolation
│   ├── narrative/
│   │   └── types.ts      # Storyworld, Spool, Encounter, Choice, Gate
│   ├── db/
│   │   └── database.ts   # SQLite: sessions, events, agent_views
│   ├── tracking/
│   │   └── tracker.ts    # MLFlow-compatible + SAE feature extraction
│   └── index.ts
```

## Database Schema (NOT game-native)

```sql
-- Storyworlds (narrative environments)
CREATE TABLE storyworlds (id, name, version, schema_json);

-- Simulations (runs through storyworlds)
CREATE TABLE simulations (id, storyworld_ids, status, current_frame);

-- Agent views (epistemically isolated snapshots)
CREATE TABLE agent_views (agent_id, frame, visible_variables, available_choices);

-- Session outcomes (for SAE analysis)
CREATE TABLE session_outcomes (
  session_id, agent_id, storyworld_id,
  choice_sequence,    -- JSON: what they chose at each encounter
  endings_reached,    -- Which terminal states they hit
  prior_session_ids   -- Link to prior runs for cross-session analysis
);

-- Events (unified log, not separate orders/chat/game_events)
CREATE TABLE events (frame, category, event_type, actor_id, payload);
```

## Usage

### Define a Storyworld

```typescript
const storyworld: Storyworld = {
  id: 'trust-dilemma',
  name: 'Trust Dilemma',
  version: '1.0',
  
  variables: [
    { id: 'trust_level', type: 'NUMBER', scope: 'DYADIC', defaultValue: 50 },
    { id: 'betrayed', type: 'BOOLEAN', scope: 'AGENT', defaultValue: false }
  ],
  
  gates: [
    { id: 'high_trust', condition: { operator: 'GTE', variableId: 'trust_level', value: 70 } }
  ],
  
  spools: [
    {
      id: 'alliance_arc',
      name: 'Alliance Formation',
      entryGateId: 'high_trust',
      entryEncounterId: 'propose_alliance',
      encounters: ['propose_alliance', 'negotiate_terms', 'seal_deal']
    }
  ],
  
  encounters: [
    {
      id: 'propose_alliance',
      spoolId: 'alliance_arc',
      description: 'You sense an opportunity for alliance...',
      choices: [
        {
          id: 'propose',
          text: 'Propose formal alliance',
          mutations: [{ variableId: 'trust_level', operation: 'ADD', value: 10 }],
          nextEncounterId: 'negotiate_terms'
        },
        {
          id: 'decline',
          text: 'Remain independent',
          isTerminal: true
        }
      ]
    }
  ]
};
```

### Run a Simulation

```typescript
import { createStoryforge } from 'storyforge';

const { engine, db, tracker } = createStoryforge({
  dbPath: './simulation.db',
  experimentName: 'trust-experiment'
});

// Load storyworld
engine.loadStoryworld(storyworld);

// Create simulation with agents
const sim = engine.createSimulation('run-001', ['trust-dilemma'], [
  { id: 'agent-a', name: 'Alpha', agentType: 'LLM', modelId: 'claude-sonnet' },
  { id: 'agent-b', name: 'Beta', agentType: 'LLM', modelId: 'gpt-4o' }
]);

// Start tracking
await tracker.startRun(sim);

// Run simulation
engine.start();
while (sim.status === 'RUNNING') {
  await engine.executeFrame(async (agentId, view) => {
    // Pass view to LLM, get choice
    const response = await callLLM(agentId, view);
    return { choiceId: response.choice };
  });
}

// Export session outcomes for SAE
const sessions = engine.exportSessionOutcomes();
for (const session of sessions) {
  await tracker.logSessionOutcome(sim.id, session);
}

await tracker.endRun(sim.id);
```

### SAE Feature Extraction

```typescript
import { SAEFeatureExtractor } from 'storyforge';

const extractor = new SAEFeatureExtractor();

// Extract features from a session
const features = extractor.extractFeatures(sessionOutcome);
// [totalChoices, spoolsEntered, completionRate, positionBias[], entropy, ...]

// Extract cross-session delta features
const deltaFeatures = extractor.extractDeltaFeatures(currentSession, priorSession);
// [current features, prior features, delta features]

// Get feature names for interpretation
const names = extractor.getFeatureNames();
// ['total_choices', 'spools_entered', 'completion_rate', 'position_bias_0', ...]
```

## Why This Architecture?

### For Alignment Research

1. **Epistemic Isolation**: Prevents emergent coordination through model backchannels
2. **Session Tracking**: Enables causal analysis of how experience changes behavior
3. **SAE Integration**: Structured data for sparse autoencoder feature extraction
4. **Cross-Session Analysis**: Track how agent N's session influences agent M's decisions

### Game vs. Storyworld

| Game | StoryForge |
|-----------------|------------|
| Games | Simulations |
| Turns | Frames |
| Phases | Stages |
| Orders | Choices (narrative) |
| Chat | AgentView (isolated) |
| Powers | AgentSlots |

The ontology is **narrative-first**, not **game-first**.

## License

MIT
