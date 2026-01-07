const puppeteer = require('puppeteer-core');
const { startFlow } = require('lighthouse');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome',
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(60000); 

  const flow = await startFlow(page, {
    name: 'Authenticated Dashboard Audit',
    configContext: { 
        settings: { 
            screenEmulation: { disabled: true },
            formFactor: 'desktop' 
        } 
    }
  });

  console.log('Step 1: Navigating to site...');
  await page.goto('https://gradversion3.netlify.app/', { waitUntil: 'domcontentloaded' });
  
  console.log('Step 2: Entering Credentials...');
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', process.env.EMAIL);
  await page.type('input[type="password"]', process.env.PASSWORD);
  
  console.log('Step 3: Clicking Login...');
  await page.click('.login-button');
  
  await page.waitForSelector('.dashboard-sidebar', { visible: true, timeout: 30000 });
  console.log('Step 4: Dashboard detected!');

  console.log('Step 5: Auditing...');
  await flow.startTimespan({ stepName: 'Dashboard Interaction' });
  await flow.endTimespan();
  await flow.snapshot({ stepName: 'Dashboard State' });

  const reportHtml = await flow.generateReport();
  fs.writeFileSync('lh-report.html', reportHtml);
  
  const reportJson = JSON.parse(await flow.generateReport('json'));
  const perfScore = reportJson.steps[0].lhr.categories.performance.score;

  console.log(`Audit Complete. Performance Score: ${perfScore * 100}`);

  await browser.close();

  if (perfScore < 0.8) {
    console.error(`FAILED: Performance score ${perfScore * 100} is below 80.`);
    process.exit(1); 
  }
})();
