module.exports = {
  appId: 'com.studyai.app',
  productName: 'StudyAI',
  directories: {
    output: 'dist-app'
  },
  files: [
    'main/**/*',
    'renderer/dist/**/*',
    'node_modules/**/*',
    '!node_modules/**/{CHANGELOG.md,README.md,readme.md,changelog.md}',
    '!node_modules/.bin',
    '!**/{test,tests,__tests__,spec,specs}/**'
  ],
  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    category: 'public.app-category.education',
    darkModeSupport: true
  },
  dmg: {
    background: null,
    window: { width: 540, height: 380 }
  },
  extraMetadata: {
    main: 'main/main.js'
  }
};
