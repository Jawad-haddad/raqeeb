const puppeteer = require('puppeteer'); 
const { startFlow } = require('lighthouse');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
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

    console.log('Step 1: Navigating to landing portal...');
    await page.goto('https://gradversion2.netlify.app/', { waitUntil: 'domcontentloaded' });
    
    console.log('Step 2: Entering Credentials...');
    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', process.env.EMAIL || '');
    await page.type('input[type="password"]', process.env.PASSWORD || '');
    
    console.log('Step 3: Triggering Authentication Client...');
    await page.click('.login-button');
    
    console.log('Step 4: Waiting for Dashboard UI routing to settle...');
    
    await page.waitForSelector('.dashboard-sidebar', { visible: true, timeout: 35000 });
    
    console.log('Step 5: Monitoring Live Signal Feed Performance...');
    await flow.startTimespan({ stepName: 'Live Data Feed Performance' });
    await new Promise(resolve => setTimeout(resolve, 10000)); 
    await flow.endTimespan();

    await flow.snapshot({ stepName: 'Final Dashboard State' });

    
    const reportHtml = await flow.generateReport();
    fs.writeFileSync('lh-report.html', reportHtml);
    console.log('HTML Report saved successfully.');

    
    const signalExists = await page.$('.status-card'); 
    if (!signalExists) {
      throw new Error('Dashboard loaded, but the Live Status Card (.status-card) is missing.');
    }

    const sidebarStatus = await page.$eval('.sidebar-subtitle', el => el.innerText);
    if (!sidebarStatus.includes('Live detection')) {
      throw new Error(`Sidebar loaded, but expected status statement missing. Found: "${sidebarStatus}"`);
    }
    
  
    const reportJson = await flow.createFlowResult();
    
    const liveStep = reportJson.steps.find(s => s.name === 'Live Data Feed Performance');
    const tbt = liveStep.lhr.audits['total-blocking-time'].displayValue || '0 ms';
    console.log(`Live Feed Total Blocking Time (TBT): ${tbt}`);
    
    const perfScore = reportJson.steps[0].lhr.categories.performance.score;
    const cleanScore = Math.round(perfScore * 100);
    console.log(`Audit Complete. Initial Navigation Performance Score: ${cleanScore}`);

    if (perfScore < 0.8) {
      console.error(`FAILED: Dashboard Performance Score (${cleanScore}) is below target threshold of 80.`);
      process.exit(1); 
    }

    console.log('All pipeline frontend checks passed successfully.');

  } catch (error) {
    console.error('CRITICAL PIPELINE EXCEPTION:', error.message);
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
    console.log('Failure screenshot compiled: error-screenshot.png');
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
