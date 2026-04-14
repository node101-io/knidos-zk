const home = process.env.HOME || '/root';

module.exports = {
  apps: [
    {
      name: 'knidos-server',
      script: 'dist/src/server.js',
      cwd: '/root/knidos-zk',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'knidos-node',
      script: 'dist/src/app.js',
      cwd: '/root/knidos-zk',
      env: {
        NODE_ENV: 'production',
        PATH: `${home}/.nargo/bin:${home}/.bb:${process.env.PATH}`,
      },
    },
  ],
};
