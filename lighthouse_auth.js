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
  // Give the CI runner more time to breathe
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
  // Use 'domcontentloaded' - it's faster and less likely to hang than 'networkidle2'
  await page.goto('https://gradversion3.netlify.app/', { waitUntil: 'domcontentloaded' });
  
  console.log('Step 2: Entering Credentials...');
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', process.env.EMAIL);
  await page.type('input[type="password"]', process.env.PASSWORD);
  
  console.log('Step 3: Logging in...');
  await page.click('.login-button');
  
  // CRITICAL FIX: Instead of waitForNavigation, we wait for the UI to change
  await page.waitForSelector('.dashboard-sidebar', { visible: true, timeout: 30000 });
  console.log('Step 4: Dashboard detected!');

  console.log('Step 5: Running Lighthouse Audit...');
  // Timespan captures the performance of the dashboard "settling"
  await flow.startTimespan({ stepName: 'Dashboard Interaction' });
  // Optional: wait 2 seconds for any Supabase data to finish fetching
  await new Promise(resolve => setTimeout(resolve, 2000)); 
  await flow.endTimespan();

  await flow.snapshot({ stepName: 'Final Dashboard State' });

  // Generate Reports
  const reportHtml = await flow.generateReport();
  fs.writeFileSync('lh-report.html', reportHtml);
  
  const reportJson = JSON.parse(await flow.generateReport('json'));
  
  // Get score from the first step (the navigation/load)
  const perfScore = reportJson.steps[0].lhr.categories.performance.score;
  console.log(`Audit Complete. Performance Score: ${Math.round(perfScore * 100)}`);

  await browser.close();

  // Failure threshold
  if (perfScore < 0.8) {
    console.error(`FAILED: Score ${perfScore * 100} is below 80 threshold.`);
    process.exit(1); 
  }
})();
