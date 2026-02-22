/**
 * Types for the install flow
 */

import type { RemotePullFailureReason } from '../remote-pull.js';
import type { InstallResolutionMode } from '../../types/install.js';
export type { InstallResolutionMode };

export interface PackageRemoteResolutionOutcome {
  name: string;
  reason: RemotePullFailureReason;
  message: string;
}
