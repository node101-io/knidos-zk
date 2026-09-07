// Stand-in for src/primus/attest-child.ts used by attest-runner.test.ts.
// Speaks the same one-request/one-response IPC protocol; the behaviour is
// picked by ATTEST_CHILD_FAKE_MODE so the runner's timeout and crash
// paths can be exercised without the Primus SDK.
const mode = process.env.ATTEST_CHILD_FAKE_MODE ?? 'ok';
function reply(response) {
  process.send(response, () => process.exit(0));
}

process.once('message', (message) => {
  switch (mode) {
    case 'ok':
      reply({
        ok: true,
        attest: {
          reportTxHash: '0xreport',
          request: message.request,
          attestedAt: 1,
          fillsSalt: '0x01',
          addressSalt: '0x02',
        },
      });
      break;
    case 'failed':
      reply({
        ok: false,
        error: { code: '10003', message: 'recv websocket header error' },
      });
      break;
    case 'exit-silently':
      process.exit(0);
      break;
    case 'hang':
      setInterval(() => {}, 1000);
      break;
    default:
      process.exit(3);
  }
});
