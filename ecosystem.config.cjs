const home = process.env.HOME || '/root';

module.exports = {
  apps: [
    {
      name: 'node-test',
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
