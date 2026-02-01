const puppeteer = require('puppeteer-core');
const { startFlow } = require('lighthouse');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome',
    headless: "new",
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage',
      '--window-size=1920,1080'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  page.setDefaultTimeout(60000); 

  try {
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
    await page.type('input[type="email"]', process.env.EMAIL || '');
    await page.type('input[type="password"]', process.env.PASSWORD || '');
    
    console.log('Step 3: Clicking Login...');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }), 
        page.click('.login-button'),
    ]);
    
    console.log('Waiting for dashboard to load...');
    await page.waitForSelector('.dashboard-sidebar', { visible: true, timeout: 30000 });
    
    console.log('Step 4: Dashboard detected!');
    await flow.startTimespan({ stepName: 'Dashboard Interaction' });
    await new Promise(resolve => setTimeout(resolve, 2000)); 
    await flow.endTimespan();

    await flow.snapshot({ stepName: 'Final Dashboard State' });

    const reportHtml = await flow.generateReport();
    fs.writeFileSync('lh-report.html', reportHtml);
    
    const reportJson = JSON.parse(await flow.generateReport('json'));
    const perfScore = reportJson.steps[0].lhr.categories.performance.score;
    console.log(`Audit Complete. Performance Score: ${Math.round(perfScore * 100)}`);

    if (perfScore < 0.8) {
      console.error(`FAILED: Score ${perfScore * 100} is below threshold.`);
      process.exit(1); 
    }

  } catch (error) {
    console.error('CRITICAL ERROR:', error.message);
    // CAPTURE SCREENSHOT ON FAILURE
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
    console.log('Error screenshot saved as error-screenshot.png');
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
