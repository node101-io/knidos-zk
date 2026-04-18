// Explicit fragment of Primus TaskContract ABI containing only the read/write
// methods this codebase uses directly via ethers. Declaring it here (rather than
// importing the SDK's full JSON) keeps the surface area we depend on explicit,
// so an SDK bump that renames or removes a field fails at our boundary instead
// of silently changing behaviour.
export const TASK_CONTRACT_ABI = [
  'function maxUnsettledTaskCount() view returns (uint256)',
  'function taskTimeout() view returns (uint256)',
  'function taskCount() view returns (uint256)',
  'function queryBalance(address user, uint8 tokenSymbol) view returns (tuple(uint8 tokenSymbol, uint256 toWithdraw, uint256 toLock, uint256 toWithdrawTaskCount, uint256 toLockTaskCount) balance)',
  'function queryUnsettledTasks(address user, uint8 tokenSymbol, uint256 offset, uint256 limit) view returns (tuple(string templateId, address submitter, address[] attestors, tuple(address attestor, bytes32 taskId, tuple(address recipient, tuple(string url, string header, string method, string body) request, tuple(tuple(string keyName, string parseType, string parsePath)[] oneUrlResponseResolve)[] responseResolve, string data, string attConditions, uint64 timestamp, string additionParams) attestation, bytes signature)[] taskResults, uint64 submittedAt, uint8 tokenSymbol, address callback, uint8 taskStatus)[] taskInfos, uint256 totalCount)',
];
