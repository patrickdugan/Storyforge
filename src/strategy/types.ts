/**
 * StoryForge - Strategy Layer
 * 
 * Optional overlay for turn-based strategy mechanics.
 * Sits ABOVE the core Frame/Event/Storyworld system, not replacing it.
 * 
 * This is a generic strategy abstraction - NOT Diplomacy-specific.
 * Think 4X, RTS, econ sims, etc.
 */

import { z } from 'zod';

// ============================================================================
// Game Turn - Groups Frames Into Strategic Units
// ============================================================================

/**
 * A GameTurn groups multiple Frames into a logical strategic unit.
 * Frames remain the timeline backbone; turns are just a view over them.
 */
export const GameTurnSchema = z.object({
  id: z.string(),
  simulationId: z.string(),
  turnIndex: z.number().int().positive(),  // 1, 2, 3...
  
  // Which frames belong to this turn
  frameStart: z.number().int().nonnegative(),
  frameEnd: z.number().int().nonnegative(),
  
  // Timing
  startedAt: z.date(),
  completedAt: z.date().optional(),
  
  // Turn-level state
  status: z.enum(['PENDING', 'ACTIVE', 'RESOLVING', 'COMPLETED']),
  
  metadata: z.record(z.unknown()).optional()
});
export type GameTurn = z.infer<typeof GameTurnSchema>;

// ============================================================================
// Game Phase - Subdivisions Within a Turn
// ============================================================================

/**
 * Phases divide a turn into distinct action windows.
 * Generic types - define your own for your game.
 */
export const PhaseTypeSchema = z.enum([
  // Economic phases
  'ECONOMY',        // Resource collection, trading
  'PRODUCTION',     // Building, recruitment
  
  // Strategic phases  
  'PLANNING',       // Strategy formulation
  'DEPLOYMENT',     // Positioning assets
  'MOVEMENT',       // Unit/asset movement
  'ENGAGEMENT',     // Combat/competition resolution
  
  // Diplomatic phases
  'NEGOTIATION',    // Inter-agent communication
  'COMMITMENT',     // Binding agreements
  
  // Narrative phases
  'STORY',          // Storyworld spool progression
  'REACTION',       // Response to narrative events
  
  // Meta phases
  'EVALUATION',     // Metrics, analysis
  'CUSTOM'          // Game-specific
]);
export type PhaseType = z.infer<typeof PhaseTypeSchema>;

export const GamePhaseSchema = z.object({
  id: z.string(),
  turnId: z.string(),
  simulationId: z.string(),
  
  phaseType: PhaseTypeSchema,
  phaseIndex: z.number().int().nonnegative(),  // Order within turn
  
  // Which frames this phase spans
  frameStart: z.number().int().nonnegative(),
  frameEnd: z.number().int().nonnegative(),
  
  // Phase state
  status: z.enum(['PENDING', 'ACTIVE', 'RESOLVING', 'COMPLETED']),
  
  // For action collection
  expectedActors: z.array(z.string()).optional(),
  receivedActions: z.array(z.string()).optional(),  // ActionOrder IDs
  
  metadata: z.record(z.unknown()).optional()
});
export type GamePhase = z.infer<typeof GamePhaseSchema>;

// ============================================================================
// Action Orders - Agent Commands in Strategy Layer
// ============================================================================

/**
 * ActionOrder is a strategic command issued by an agent.
 * NOT "orders" in the Diplomacy sense - generic action abstraction.
 */
export const ActionCategorySchema = z.enum([
  // Economic actions
  'TRADE',          // Exchange resources
  'INVEST',         // Allocate to growth
  'HARVEST',        // Collect resources
  
  // Unit/asset actions
  'MOVE',           // Relocate asset
  'DEPLOY',         // Position asset
  'WITHDRAW',       // Remove from position
  
  // Engagement actions
  'ATTACK',         // Hostile action
  'DEFEND',         // Protective action
  'SUPPORT',        // Assist another
  
  // Diplomatic actions
  'PROPOSE',        // Make offer
  'ACCEPT',         // Accept offer
  'REJECT',         // Reject offer
  'SIGNAL',         // Send information
  
  // Narrative actions
  'CHOOSE',         // Storyworld choice (bridges to narrative layer)
  'OBSERVE',        // Gather information
  
  // Meta actions
  'PASS',           // Skip action
  'DELEGATE',       // Assign to another
  'CUSTOM'
]);
export type ActionCategory = z.infer<typeof ActionCategorySchema>;

export const ActionOrderSchema = z.object({
  id: z.string(),
  simulationId: z.string(),
  turnId: z.string(),
  phaseId: z.string(),
  frameId: z.number().int().nonnegative(),  // Links to Frame timeline
  
  // Who and what
  actorId: z.string(),
  category: ActionCategorySchema,
  actionType: z.string(),  // More specific: "MOVE_ARMY", "BUY_BOND", etc.
  
  // Action details
  payload: z.record(z.unknown()),
  
  // Target (if applicable)
  targetId: z.string().optional(),        // Another agent
  targetLocation: z.string().optional(),  // Position/zone
  targetAsset: z.string().optional(),     // Specific asset
  
  // Resolution
  status: z.enum(['PENDING', 'VALIDATED', 'INVALID', 'EXECUTED', 'FAILED', 'CANCELLED']),
  validationNotes: z.string().optional(),
  resolutionNotes: z.string().optional(),
  
  // Timing
  submittedAt: z.date(),
  resolvedAt: z.date().optional(),
  
  // For analysis
  metadata: z.record(z.unknown()).optional()
});
export type ActionOrder = z.infer<typeof ActionOrderSchema>;

// ============================================================================
// Action Resolution - What Happened
// ============================================================================

export const ActionResultSchema = z.object({
  orderId: z.string(),
  success: z.boolean(),
  
  // What changed
  effects: z.array(z.object({
    effectType: z.string(),
    target: z.string().optional(),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    description: z.string().optional()
  })),
  
  // Why it succeeded/failed
  reason: z.string().optional(),
  
  // Conflicts with other actions
  conflictsWith: z.array(z.string()).optional(),  // Other order IDs
  
  resolvedAt: z.date()
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const PhaseResolutionSchema = z.object({
  phaseId: z.string(),
  turnId: z.string(),
  
  // All action results
  actionResults: z.array(ActionResultSchema),
  
  // Aggregate effects
  stateChanges: z.array(z.record(z.unknown())),
  
  // Summary for logging
  summary: z.string(),
  
  resolvedAt: z.date()
});
export type PhaseResolution = z.infer<typeof PhaseResolutionSchema>;

// ============================================================================
// Strategy Game Config
// ============================================================================

export const StrategyConfigSchema = z.object({
  // Turn structure
  phasesPerTurn: z.array(PhaseTypeSchema),
  framesPerPhase: z.number().int().positive().optional(),
  
  // Action rules
  actionsPerPhase: z.number().int().positive().optional(),
  simultaneousResolution: z.boolean().optional(),  // All actions resolve at once
  
  // Timing
  phaseTimeoutMs: z.number().int().positive().optional(),
  turnTimeoutMs: z.number().int().positive().optional(),
  
  // Victory conditions (game-specific)
  victoryConditions: z.array(z.object({
    conditionType: z.string(),
    params: z.record(z.unknown())
  })).optional()
});
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;

// ============================================================================
// Bridge: Strategy Action → Narrative Choice
// ============================================================================

/**
 * When an ActionOrder has category 'CHOOSE', it bridges to the narrative layer.
 * This maintains the connection between strategy and storyworld.
 */
export interface StrategyNarrativeBridge {
  actionOrderId: string;
  encounterId: string;
  choiceId: string;
  
  // Context from strategy layer
  strategicContext: {
    turnIndex: number;
    phaseType: PhaseType;
    actorPosition?: string;
    actorResources?: Record<string, number>;
  };
  
  // Result from narrative layer
  narrativeResult?: {
    spoolProgressed: boolean;
    variablesMutated: string[];
    newEncounter?: string;
  };
}
