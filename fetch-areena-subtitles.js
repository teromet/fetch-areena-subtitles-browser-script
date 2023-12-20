// ==UserScript==
// @name         Fetch Areena Subtitles
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description
// @author       teromet
// @require      http://code.jquery.com/jquery-3.4.1.min.js
// @include      /^https:\/\/areena\.yle\.fi\/\d-\d+$/
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_addStyle
// ==/UserScript==

GM_addStyle('.download-button svg {width:1.25rem;height:1.25rem;}.download-button { margin-left: 1rem; background: #11b4c7; width: 150px; } .download-completed { background: #67ed91; } div[class^="HeaderPlayControls_playControl"] span { display: flex; }');

const playerUiSettings = {"subtitlesSizeMultiplier":1,"$version":1,"muted":true,"volume":0.68,"selectedVideoTrack":{"bitrate":6357432,"label":"1080p HD"},"userPreferredSubtitles":{"label":"ohjelmatekstitys","language":"fi"}};

(async function() {

const pageProps = unsafeWindow.__NEXT_DATA__.props.pageProps;
let btnSelector = 'div[class^="HeaderPlayControls_playControl"] button';

const playBtnExists = () => {

    return new Promise(function(resolve, reject) {
      const btnCheck = setInterval(async() => {
        let exists = $(btnSelector).length || false;
        if(exists) {
            resolve();
            clearInterval(btnCheck);
        }
      }, 100);
    })

};

$(document).ready(async function(){

    localStorage.clear();
    localStorage.setItem('PlayerUI:settings', JSON.stringify(playerUiSettings));

    await playBtnExists();

    if(subtitlesAvailable(pageProps)) {
        let downloadButton = $(btnSelector).clone();
        downloadButton.find('span').text("Subtitles");
        downloadButton.addClass('download-button');
        downloadButton.find('svg').remove();
        downloadButton.prepend('<svg class="w-6 h-6 text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20"><path d="M14.707 7.793a1 1 0 0 0-1.414 0L11 10.086V1.5a1 1 0 0 0-2 0v8.586L6.707 7.793a1 1 0 1 0-1.414 1.414l4 4a1 1 0 0 0 1.416 0l4-4a1 1 0 0 0-.002-1.414Z"/><path d="M18 12h-2.55l-2.975 2.975a3.5 3.5 0 0 1-4.95 0L4.55 12H2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2Zm-3 5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>');
        downloadButton.insertAfter(btnSelector);
    }

    $('.download-button').on('click', function(){
        getSubtitleResources();
    });


});

const getSubtitleResources = async () => {

    // Start playback
    $('div[class^="HeaderPlayControls_playControl"] button:not(".download-button")').click();

    var proxied = window.XMLHttpRequest.prototype.open;
    let resourceFound = false;

    window.XMLHttpRequest.prototype.open = async function() {
        arguments[1] = arguments[1] + '&debug=1';
        let requestURL = arguments[1];
        if(!resourceFound && requestURL && requestURL.includes("ylekaodamd.akamaized.net") && requestURL.includes("vtt")) {
        resourceFound = true;
        fetchSubtitles(requestURL);
        return;
        }
        return proxied.apply(this, [].slice.call(arguments));
    };
}

const convertToMinutes = (timeInHour) => {

    let timeParts = timeInHour.split(":");
    return Number(timeParts[0]) * 60 + Number(timeParts[1]);

}

const subtitlesAvailable = (pageProps) => {

    let labels = pageProps.view.header.labels;

    for (const label of labels) {
        if(label.formatted.indexOf("ekstitys") !== -1) {
            return true;
        }
    }

    return false;

}

const fetchSubtitles = async (resourceURL) => {

    $('button[class^="VideoTitle__BackButton"]').click();
     // Fetch media info from global object
    let mediaTitle = pageProps.meta.title;
    let releaseDate = pageProps.meta.item.releaseDate;

    let runTime = pageProps.meta.item.duration.substring(
        pageProps.meta.item.duration.indexOf("PT") + 2,
        pageProps.meta.item.duration.lastIndexOf("S")
    );
    let runTimeMinutes = Math.round(parseInt(runTime) / 60);

    let subtitles = await getSubtitlesContent(resourceURL, runTimeMinutes);
    let subtitlesFixed = [...new Set(subtitles.split(/\n\s*\n/))].join("\n\n");

    $('.download-button span').text('Completed');
    $('.download-button').addClass('download-completed');

    const newBlob = new Blob([subtitlesFixed], { type: 'text/plain' });

    if (window.navigator && window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveOrOpenBlob(newBlob);
    } else {

        const objUrl = window.URL.createObjectURL(newBlob);

        let link = document.createElement('a');
        link.href = objUrl;
        link.download = await generateFileName(mediaTitle, releaseDate);
        link.click();

        setTimeout(() => { window.URL.revokeObjectURL(objUrl); }, 250);

    }

};


const getSubtitlesContent = async (playlistUrl, runTimeMinutes) => {

    let urlParts = playlistUrl.split('seg-1');
    let segmentIndex = 1;
    let subtitles = "";
    let currentPercentage = 0;
    let segmentNotFound = false;

    const awaitTimeout = (delay, reason) =>
        new Promise((resolve, reject) =>
        setTimeout(
        () => (reason === undefined ? resolve() : reject(reason)),
        delay
        )
    );

    const wrapPromise = (promise, delay, reason) =>
    Promise.race([promise, awaitTimeout(delay, reason)]);

    while(!segmentNotFound) {

        let response = await wrapPromise(fetch(urlParts[0] + 'seg-' + segmentIndex + urlParts[1]), 30000, {
            reason: 'Fetch timeout',
        });

        if(response.status == 404) {
            segmentNotFound = true;
        }

        let resText = await response.text();
        let lines = resText.split('\n');

        lines.splice(0,2);
        let lines2 = lines;
        let subSegment = lines.join('\n');

        lines2.splice(0,1);

        if(lines2[0]) {
            let currentMinutes = convertToMinutes(lines2[0].substring(0,5));
            let percentage = Math.round(currentMinutes/runTimeMinutes * 100);

            if(percentage > currentPercentage) {
                $('.download-button span').text(percentage + '%');
            }

            currentPercentage = percentage != currentPercentage ? percentage : currentPercentage;
        }

        subtitles = subtitles + "\n" + subSegment;

        segmentIndex++;


    }
    return subtitles.trimStart();

};

const generateFileName = async (mediaTitle, releaseDate) => {

    let seasonEps, seasonEpsArr;
    let fileName = mediaTitle;
    let lang = 'fi';

    // Tv episodes, news, clips etc.
    if (fileName.match(/\|/g)) {
        if (fileName.match(/K\d+, J\d+/g)) {
            seasonEps = fileName.split(':')[0];
            seasonEpsArr = seasonEps.match(/\d+/g);

            if (seasonEpsArr.length) {
                let season = seasonEpsArr[0];
                let episode = seasonEpsArr[1];
                fileName = fileName.split("| ")[1] + ' S' + season.toString().padStart(2, '0') + 'E' + episode.toString().padStart(2, '0');
            }

        }
        else {
            let released = new Date(releaseDate).toLocaleString('fi-FI').split(' ')[0];
            fileName = fileName.indexOf('|') !== -1 ? fileName.split("| ")[1] + ' ' + released : fileName + ' ' + released;
        }
    }

    fileName = fileName.replace(/,/g, " ") + "." + lang.toUpperCase() + ".srt";

    return fileName;

};

})();