// pageScraper.js
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs').promises;

const scraperObject = {
    async askForSearchTerm() {
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise(resolve => {
            readline.question('Enter your search term: ', term => {
                readline.close();
                resolve(term);
            });
        });
    },

    async constructSearchUrl(searchTerm, page) {
        return `https://www.aliexpress.com/w/wholesale-${searchTerm}.html?page=${page}&g=y&SearchText=${searchTerm}`;
    },

    async extractDetails(newPage, searchTerm) {
        let dataObj = {};

        dataObj['Category'] = searchTerm;
        dataObj['productName'] = await newPage.$eval('#root > div > div.pdp-body.pdp-wrap > div > div.pdp-body-top-left > div.pdp-info > div.pdp-info-right > div.title--wrap--Ms9Zv4A > h1', text => text.textContent).catch(() => null);
        dataObj['productPrice'] = await newPage.$eval('#root > div > div.pdp-body.pdp-wrap > div > div.pdp-body-top-left > div.pdp-info > div.pdp-info-right > div.price--wrap--tA4MDk4.product-price.price--hasDiscount--LTvrFnq > div.price--current--H7sGzqb.product-price-current > div', text => text.textContent).catch(() => null);
        dataObj['Sold'] = await newPage.$eval('#root > div > div.pdp-body.pdp-wrap > div > div.pdp-body-top-left > div.pdp-info > div.pdp-info-right > div.reviewer--wrap--sPGWrNq', text => text.textContent).catch(() => null);
        dataObj['rating'] = await newPage.$eval('#root > div > div.pdp-body.pdp-wrap > div > div.pdp-body-top-left > div.pdp-info > div.pdp-info-right > div.reviewer--wrap--sPGWrNq > strong', text => text.textContent).catch(() => null);
        dataObj['reviews'] = await newPage.$eval('#root > div > div.pdp-body.pdp-wrap > div > div.pdp-body-top-left > div.pdp-info > div.pdp-info-right > div.reviewer--wrap--sPGWrNq > a', text => text.textContent).catch(() => null);

        // Scrape image URL
        const imgElement = await newPage.$('#root > div > div.pdp-body.pdp-wrap > div > div.pdp-body-top-left > div.pdp-info > div.pdp-info-left > div > div > div.image-view--previewWrap--kSHfegR > div.image-view--previewBox--FyWaIlU > div > img');
        dataObj['image'] = imgElement ? await imgElement.evaluate(img => img.src).catch(() => null) : null;

        // Clean up values to replace commas with a point or a space
        Object.keys(dataObj).forEach((key) => {
            if (dataObj[key] && typeof dataObj[key] === 'string') {
                dataObj[key] = dataObj[key].replace(/,/g, ' ');
            }
        });

        return dataObj;
    },

    async extractLinks(page) {
        await page.waitForSelector('#root > div.root--container--2gVZ5S0.root--newRoot--2-6FirH.search-root-cls');

        const baseSelector = '#card-list > div:nth-child';
        const linkSelector = ' > div > a';

        const links = [];
        let i = 1;

        while (true) {
            const currentLinkSelector = baseSelector + `(${i})` + linkSelector;
            const url = await page.$eval(currentLinkSelector, link => link.href).catch(() => null);

            if (!url) {
                break;
            }

            links.push(url);
            i++;
        }

        return links;
    },

    async scraper(browser) {
        let allScrapedData = [];

        // Collect search terms
        const searchTerms = [];
        while (true) {
            const searchTerm = await this.askForSearchTerm();

            if (searchTerm.toLowerCase() === 'end') {
                break;
            }

            console.log(`Searching for: ${searchTerm}`);
            searchTerms.push(searchTerm);
        }

        // Process each search term
        for (const searchTerm of searchTerms) {
            let page;
            let currentPage = 1;
            let allLinks = [];
            let scrapedData = [];

            try {
                page = await browser.newPage();

                while (true) {
                    const searchUrl = await this.constructSearchUrl(searchTerm, currentPage);
                    console.log(`Navigating to ${searchUrl}...`);
                    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

                    await page.evaluate(async () => {
                        await new Promise(resolve => {
                            let totalHeight = 0;
                            const distance = 100;
                            const timer = setInterval(() => {
                                const scrollHeight = document.body.scrollHeight;
                                window.scrollBy(0, distance);
                                totalHeight += distance;

                                if (totalHeight >= scrollHeight) {
                                    clearInterval(timer);
                                    resolve();
                                }
                            }, 100);
                        });
                    });

                    const linksOnCurrentPage = await this.extractLinks(page);
                    allLinks = allLinks.concat(linksOnCurrentPage);

                    if (linksOnCurrentPage.length === 0) {
                        console.log(`No more pages available for the current search term.`);
                        break; 
                    }

                    for (const link of linksOnCurrentPage) {
                        let newPage;

                        try {
                            newPage = await browser.newPage();
                            await newPage.goto(link, { waitUntil: 'domcontentloaded' });
                            const details = await this.extractDetails(newPage, searchTerm);
                            scrapedData.push(details);
                            console.log(details);
                        } catch (error) {
                            console.error("Error scraping details:", error);
                        } finally {
                            if (newPage) {
                                await newPage.close();
                            }
                        }
                    }

                    currentPage++;
                }
            } catch (error) {
                console.error("Error navigating or scraping:", error);
            } finally {
                if (page) {
                    await page.close();
                }
            }

            // Save scraped data to CSV after processing each search term
            allScrapedData = allScrapedData.concat(scrapedData);
            await this.saveToCsv(allScrapedData);
        }

        // Write to CSV file
        console.log('Scraping finished. Closing the browser...');
        await browser.close();
    },

    async saveToCsv(data) {
        const csvFilePath = 'scraped_data.csv';
        let csvExists = false;

        try {
            await fs.access(csvFilePath);
            csvExists = true;
        } catch (error) {
        }

        const csvWriter = createCsvWriter({
            path: csvFilePath,
            header: [
                { id: 'Category', title: 'Category' },
                { id: 'productName', title: 'Product Name' },
                { id: 'productPrice', title: 'Price' },
                { id: 'Sold', title: 'Sold' },
                { id: 'rating', title: 'Rating' },
                { id: 'reviews', title: 'Reviews' },
                { id: 'image', title: 'Image' },
            ],
            append: csvExists,
        });

        if (!csvExists) {
            // If the file doesn't exist, write the header
            await csvWriter.writeRecords([]);
        }

        await csvWriter.writeRecords(data);
    }
};

module.exports = scraperObject;
