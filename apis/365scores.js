const admin = require("firebase-admin");

const BASE_URL =
    "https://webws.365scores.com/web/games/allscores/";

const IMAGE_URL =
    "https://imagecache.365scores.com/image/upload/f_auto,w_120,h_120,c_limit,q_auto:eco/v2/competitors/";

const TIME_ZONE = "Asia/Kolkata";

const HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://www.365scores.com/",
    "Origin": "https://www.365scores.com"
};

// --------------------------------------------------
// FIREBASE INITIALIZATION
// --------------------------------------------------

function initializeFirebase() {
    if (admin.apps.length > 0) {
        return admin.database();
    }

    const serviceAccountJson =
        process.env.FIREBASE_SERVICE_ACCOUNT;

    const databaseURL =
        process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountJson) {
        throw new Error(
            "Missing FIREBASE_SERVICE_ACCOUNT secret"
        );
    }

    if (!databaseURL) {
        throw new Error(
            "Missing FIREBASE_DATABASE_URL secret"
        );
    }

    const serviceAccount = JSON.parse(
        serviceAccountJson
    );

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: databaseURL
    });

    return admin.database();
}

// --------------------------------------------------
// DATE HELPERS
// --------------------------------------------------

function getDateParts(date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(date);

    const result = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            result[part.type] = part.value;
        }
    }

    return result;
}

function formatApiDate(date) {
    const p = getDateParts(date);

    return p.day + "/" + p.month + "/" + p.year;
}

function formatMatchDate(dateValue) {
    const date = new Date(dateValue);

    if (isNaN(date.getTime())) {
        return "";
    }

    const p = getDateParts(date);

    return p.day + "-" + p.month + "-" + p.year;
}

function formatMatchTime(dateValue) {
    const date = new Date(dateValue);

    if (isNaN(date.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).format(date);
}

function getDateOffset(days) {
    const now = new Date();

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(now);

    const values = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    }

    const base = new Date(Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day) + days,
        12,
        0,
        0
    ));

    return base;
}

// --------------------------------------------------
// FETCH 365SCORES
// --------------------------------------------------

async function fetchGames(sportId, date) {
    const params = new URLSearchParams({
        appTypeId: "5",
        langId: "1",
        timezoneName: TIME_ZONE,
        userCountryId: "113",
        sports: String(sportId),
        startDate: formatApiDate(date),
        endDate: formatApiDate(date),
        showOdds: "true",
        onlyMajorGames: "false",
        withTop: "true"
    });

    const url = BASE_URL + "?" + params.toString();

    console.log(
        "Fetching 365Scores | Sport:",
        sportId,
        "| Date:",
        formatApiDate(date)
    );

    const response = await fetch(url, {
        method: "GET",
        headers: HEADERS,
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
        throw new Error(
            "365Scores HTTP " +
            response.status +
            " for sport " +
            sportId
        );
    }

    const data = await response.json();

    if (!Array.isArray(data.games)) {
        console.log(
            "No games array returned for sport",
            sportId
        );

        return [];
    }

    console.log(
        "Games received:",
        data.games.length
    );

    return data.games;
}

// --------------------------------------------------
// SPORT ID HELPERS
// --------------------------------------------------

function normalizeSportIds(settings) {
    const result = new Set();

    const selectedSports = settings.selected_sports;

    if (Array.isArray(selectedSports)) {
        for (const item of selectedSports) {
            const id =
                typeof item === "object" && item !== null
                    ? item.id
                    : item;

            const number = Number(id);

            if (Number.isInteger(number) && number > 0) {
                result.add(number);
            }
        }
    } else if (
        selectedSports &&
        typeof selectedSports === "object"
    ) {
        for (const key of Object.keys(selectedSports)) {
            const item = selectedSports[key];

            const id =
                typeof item === "object" && item !== null
                    ? item.id
                    : item;

            const number = Number(id || key);

            if (Number.isInteger(number) && number > 0) {
                result.add(number);
            }
        }
    }

    if (result.size === 0) {
        const selectedSport = Number(
            settings.selected_sport || 1
        );

        if (
            Number.isInteger(selectedSport) &&
            selectedSport > 0
        ) {
            result.add(selectedSport);
        }
    }

    return Array.from(result);
}

// --------------------------------------------------
// STATUS HELPERS
// --------------------------------------------------

function getMatchStatus(game) {
    const text = String(
        game.statusText || ""
    ).trim();

    const shortText = String(
        game.shortStatusText || text
    ).trim();

    const normalized =
        (text + " " + shortText).toLowerCase();

    if (
        normalized.includes("postponed") ||
        normalized.includes("ppd")
    ) {
        return {
            status: "Postponed",
            shortStatus: "PPD"
        };
    }

    if (
        normalized.includes("cancelled") ||
        normalized.includes("canceled") ||
        normalized.includes("canc")
    ) {
        return {
            status: "Cancelled",
            shortStatus: "CANC"
        };
    }

    if (
        normalized.includes("abandoned") ||
        normalized.includes("abd")
    ) {
        return {
            status: "Abandoned",
            shortStatus: "ABD"
        };
    }

    if (
        normalized.includes("penalties") ||
        normalized.includes("penalty shootout")
    ) {
        return {
            status: "After Penalties",
            shortStatus: "AP"
        };
    }

    if (
        normalized === "ht" ||
        normalized.includes("half time") ||
        normalized.includes("halftime")
    ) {
        return {
            status: "Half Time",
            shortStatus: "HT"
        };
    }

    if (
        normalized.includes("extra time") ||
        normalized === "et"
    ) {
        return {
            status: "Extra Time",
            shortStatus: "ET"
        };
    }

    if (
        normalized.includes("live") ||
        normalized.includes("in progress") ||
        normalized.includes("1st half") ||
        normalized.includes("2nd half") ||
        normalized.includes("quarter") ||
        normalized.includes("period")
    ) {
        return {
            status: "Live",
            shortStatus: shortText || "LIVE"
        };
    }

    if (
        normalized.includes("ended") ||
        normalized.includes("finished") ||
        normalized.includes("final") ||
        normalized === "ft"
    ) {
        return {
            status: "Finished",
            shortStatus: "FT"
        };
    }

    return {
        status: text || "Upcoming",
        shortStatus: shortText || "NS"
    };
}

// --------------------------------------------------
// COMPETITION HELPERS
// --------------------------------------------------

function getCompetitionName(game) {
    return (
        game.competitionDisplayName ||
        game.competitionName ||
        game.competition ||
        "Unknown Competition"
    );
}

function getCompetitionId(game) {
    const id = Number(game.competitionId);

    if (!Number.isInteger(id) || id <= 0) {
        return null;
    }

    return id;
}

// --------------------------------------------------
// MATCH CONVERSION
// --------------------------------------------------

function convertMatch(game, oldMatch) {
    const gameId = Number(game.id);

    const home = game.homeCompetitor || {};
    const away = game.awayCompetitor || {};

    const homeId = Number(home.id || 0);
    const awayId = Number(away.id || 0);

    const startTime = game.startTime || "";

    const timestamp = Date.parse(startTime);

    if (
        !Number.isInteger(gameId) ||
        gameId <= 0 ||
        !Number.isFinite(timestamp)
    ) {
        return null;
    }

    const homeScore =
        home.score === undefined ||
        home.score === null
            ? ""
            : home.score;

    const awayScore =
        away.score === undefined ||
        away.score === null
            ? ""
            : away.score;

    const status = getMatchStatus(game);

    const oldStreamUrl =
        oldMatch &&
        typeof oldMatch.streamUrl === "string"
            ? oldMatch.streamUrl
            : "";

    return {
        gameId: gameId,

        sportId: Number(game.sportId || 1),

        competitionId: getCompetitionId(game),

        league: getCompetitionName(game),

        home: home.name || "Home",

        away: away.name || "Away",

        homeCompetitorId: homeId,

        awayCompetitorId: awayId,

        homeLogo: homeId > 0
            ? IMAGE_URL + homeId
            : "",

        awayLogo: awayId > 0
            ? IMAGE_URL + awayId
            : "",

        score:
            homeScore !== "" && awayScore !== ""
                ? homeScore + " - " + awayScore
                : "VS",

        status: status.status,

        shortStatus: status.shortStatus,

        date: formatMatchDate(startTime),

        time: formatMatchTime(startTime),

        matchTimeMillis: timestamp,

        stadium: game.venueName || "",

        // Preserve the URL entered by the SportsHub admin.
        streamUrl: oldStreamUrl
    };
}

// --------------------------------------------------
// MAIN SYNC
// --------------------------------------------------

async function main() {
    const db = initializeFirebase();

    console.log("==================================");
    console.log("SportsHub 365Scores Sync Started");
    console.log("==================================");

    const settingsSnapshot = await db
        .ref("settings")
        .once("value");

    const settings = settingsSnapshot.val() || {};

    const sports = normalizeSportIds(settings);

    console.log("Selected sport IDs:", sports);

    const selectionSnapshot = await db
        .ref("competition_selection")
        .once("value");

    const competitionSelection =
        selectionSnapshot.val() || {};

    const competitionsSnapshot = await db
        .ref("competitions")
        .once("value");

    const existingCompetitions =
        competitionsSnapshot.val() || {};

    const matchesSnapshot = await db
        .ref("matches")
        .once("value");

    const existingMatches =
        matchesSnapshot.val() || {};

    const discoveredGames = [];

    // Fetch yesterday, today and tomorrow.
    // Run sequentially to avoid excessive API requests.

    for (const sportId of sports) {
        for (const offset of [-1, 0, 1]) {
            const date = getDateOffset(offset);

            try {
                const games = await fetchGames(
                    sportId,
                    date
                );

                discoveredGames.push(...games);
            } catch (error) {
                console.error(
                    "Fetch failed | sport:",
                    sportId,
                    "| date:",
                    formatApiDate(date),
                    "| error:",
                    error.message
                );
            }

            // Small delay between requests.
            await new Promise(resolve =>
                setTimeout(resolve, 500)
            );
        }
    }

    console.log(
        "Total games received:",
        discoveredGames.length
    );

    const competitionUpdates = {};
    const selectionUpdates = {};
    const matchUpdates = {};

    const seenGames = new Set();

    let newCompetitionCount = 0;
    let selectedGameCount = 0;

    for (const game of discoveredGames) {
        const competitionId = getCompetitionId(game);

        if (competitionId === null) {
            continue;
        }

        const competitionKey =
            String(competitionId);

        const sportId = Number(game.sportId || 1);

        const competitionName =
            getCompetitionName(game);

        const oldCompetition =
            existingCompetitions[competitionKey] || {};

        // Keep the user's existing selection.
        // Newly discovered competitions default to false.

        let selected;

        if (
            Object.prototype.hasOwnProperty.call(
                competitionSelection,
                competitionKey
            )
        ) {
            selected =
                competitionSelection[competitionKey] === true;
        } else {
            selected = oldCompetition.selected === true;
        }

        if (
            !Object.prototype.hasOwnProperty.call(
                competitionSelection,
                competitionKey
            )
        ) {
            selectionUpdates[competitionKey] = selected;
        }

        competitionUpdates[competitionKey] = {
            id: competitionId,
            name: competitionName,
            sportId: sportId,
            selected: selected
        };

        if (!oldCompetition.id) {
            newCompetitionCount++;
        }

        // Do not sync matches from unselected competitions.
        if (!selected) {
            continue;
        }

        const gameId = Number(game.id);

        if (
            !Number.isInteger(gameId) ||
            gameId <= 0
        ) {
            continue;
        }

        const gameKey = String(gameId);

        // Avoid duplicate processing if API responses overlap.
        if (seenGames.has(gameKey)) {
            continue;
        }

        seenGames.add(gameKey);

        const oldMatch = existingMatches[gameKey] || {};

        const match = convertMatch(game, oldMatch);

        if (!match) {
            continue;
        }

        // Never erase a stream URL previously entered in Admin.
        if (
            oldMatch.streamUrl &&
            !match.streamUrl
        ) {
            match.streamUrl = oldMatch.streamUrl;
        }

        matchUpdates[gameKey] = match;

        selectedGameCount++;
    }

    // Update competitions without deleting existing records.
    if (Object.keys(competitionUpdates).length > 0) {
        await db.ref("competitions").update(
            competitionUpdates
        );
    }

    // Initialize selection only for newly discovered IDs.
    // Existing true/false selections remain unchanged.
    if (Object.keys(selectionUpdates).length > 0) {
        await db.ref("competition_selection").update(
            selectionUpdates
        );
    }

    // Update only selected competition matches.
    // Existing matches outside this result are not deleted.
    if (Object.keys(matchUpdates).length > 0) {
        await db.ref("matches").update(matchUpdates);
    }

    console.log("==================================");
    console.log("365Scores Sync Completed");
    console.log("Sports:", sports.join(", "));
    console.log("Games received:", discoveredGames.length);
    console.log("Competitions discovered:", Object.keys(competitionUpdates).length);
    console.log("New competitions:", newCompetitionCount);
    console.log("Selected matches synced:", selectedGameCount);
    console.log("==================================");
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch(error => {
        console.error("365Scores sync failed:", error);

        process.exit(1);
    });
