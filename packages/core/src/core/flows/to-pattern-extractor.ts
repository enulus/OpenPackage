/**
 * Resolve a single target pattern string from a Flow's `to` field.
 * Handles string, FlowPatternValue, MultiTargetFlows, and SwitchExpression.
 *
 * Flow.to is currently typed as `string | MultiTargetFlows | SwitchExpression`
 * but runtime/platforms.jsonc also allows FlowPatternValue. The cast inside
 * `Object.keys(to as MultiTargetFlows)` is the marker for that future widening.
 */
import type { Flow, MultiTargetFlows, SwitchExpression } from '../../types/flows.js';
import { isSwitchExpression } from './switch-resolver.js';
import { isFlowPatternValue } from './flow-source-discovery.js';

export function extractToPatternString(
  to: Flow['to'],
  resolveSwitch: (expr: SwitchExpression) => string | undefined
): string | undefined {
  if (typeof to === 'string') return to;
  if (to === null || typeof to !== 'object') return undefined;
  if (isSwitchExpression(to)) return resolveSwitch(to);
  if (isFlowPatternValue(to)) return to.pattern;
  return Object.keys(to as MultiTargetFlows)[0];
}
