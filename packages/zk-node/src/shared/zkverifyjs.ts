import * as zkverifyjs from 'zkverifyjs';
import type * as ZkVerifyJs from 'zkverifyjs';

type ZkVerifyJsModule = typeof zkverifyjs;
type ZkVerifyJsCompatModule = ZkVerifyJsModule & {
  default?: ZkVerifyJsModule;
  'module.exports'?: ZkVerifyJsModule;
};

const compat = zkverifyjs as ZkVerifyJsCompatModule;

// tsx resolves zkverifyjs through a CommonJS wrapper in dev, while native ESM
// exposes the named exports directly. Keep that package interop in one place.
const zkv = (
  'module.exports' in compat && compat['module.exports']
    ? compat['module.exports']
    : 'default' in compat && compat.default
      ? compat.default
      : zkverifyjs
) as ZkVerifyJsModule;

export const zkVerifySession = zkv.zkVerifySession;
export const UltrahonkVariant = zkv.UltrahonkVariant;
export const UltrahonkVersion = zkv.UltrahonkVersion;

export type zkVerifySession = ZkVerifyJs.zkVerifySession;
export type VerifyTransactionInfo = ZkVerifyJs.VerifyTransactionInfo;
export type UltrahonkVariant = ZkVerifyJs.UltrahonkVariant;
