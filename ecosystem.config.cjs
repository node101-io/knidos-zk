const home = process.env.HOME || '/root';

module.exports = {
  apps: [
    {
      name: 'knidos-server',
      script: 'pnpm',
      args: 'server',
      cwd: '/root/knidos-zk',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'knidos-node',
      script: 'pnpm',
      args: 'node',
      cwd: '/root/knidos-zk',
      env: {
        NODE_ENV: 'production',
        PATH: `${home}/.nargo/bin:${home}/.bb:${process.env.PATH}`,
      },
    },
  ],
};
