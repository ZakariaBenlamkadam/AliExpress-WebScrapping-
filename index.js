
const browserObject = require('./browser');
const scraperController = require('./pageController');

async function runScraper() {
    // Start the browser and create a browser instance
    let browserInstance = await browserObject.startBrowser();

    await scraperController(browserInstance);
}

runScraper();
