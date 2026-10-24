
"use strict";

const axios = require("axios");

const BASE_URL =
    "https://webws.365scores.com/web/games/";

const CATALOG_URL =
    "https://webws.365scores.com/web/sports/";

const GAME_URL =
    "https://webws.365scores.com/web/game/";

const TIME_ZONE = "Asia/Kolkata";

function getParams(extra) {
    return Object.assign({
        appTypeId: 5,
        langId: 1,
        timezoneName: TIME_ZONE,
        userCountryId: 113,
        withTop: true,
        onlyMajorGames: false
    }, extra || {});
}

function toNumber(value, fallback) {
    const result = Number(value);

    return Number.isFinite(result)
        ? result
        : (fallback || 0);
}

function toStringValue(value) {
    return value === undefined || value === null
        ? ""
        : String(value);
}

function getDateString(date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(date);

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    return values.day + "/" +
        values.month + "/" +
        values.year;
}

function getFirebaseDate(date) {
    if (!date) {
        return "";
    }

    const parsed = new Date(date);

    if (isNaN(parsed.getTime())) {
        return "";
    }

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(parsed);

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    return values.day + "-" +
        values.month + "-" +
        values.year;
}

function getFirebaseTime(date) {
    if (!date) {
        return "";
    }

    const parsed = new Date(date);

    if (isNaN(parsed.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).format(parsed);
}

function getTimestamp(date) {
    if (!date) {
        return 0;
    }

    const timestamp = new Date(date).getTime();

    return Number.isFinite(timestamp)
        ? timestamp
        : 0;
}

function getCompetitor(game, side) {
    const key = side === "home"
        ? "homeCompetitor"
        : "awayCompetitor";

    return game[key] || {};
}

function getCompetitorLogo(competitor) {
    const id = competitor.id;

    if (!id) {
        return "";
    }

    return "https://imagecache.365scores.com/image/upload/" +
        "f_auto,w_120,h_120,c_limit,q_auto:eco/v2/competitors/" +
        encodeURIComponent(String(id));
}

function getScore(home, away) {
    if (
        home.score === undefined ||
        home.score === null ||
        away.score === undefined ||
        away.score === null
    ) {
        return "";
    }

    return String(home.score) + " - " +
        String(away.score);
}

function normalizeGoalEvents(events) {
    if (!Array.isArray(events)) {
        return [];
    }

    return events.map(function (event) {
        return {
            competitorId: toNumber(event.competitorId),
            gameTime: toStringValue(event.gameTime),
            playerId: toNumber(event.playerId),
            playerName: toStringValue(event.playerName),
            type: toStringValue(event.type)
        };
    });
}

/*
 * Normalize one game to the Firebase match structure.
 */
function normalizeMatch(game) {
    game = game || {};

    const home = getCompetitor(game, "home");
    const away = getCompetitor(game, "away");

    const gameId = toStringValue(
        game.id || game.gameId
    );

    const startTime = game.startTime || "";

    const timestamp = getTimestamp(startTime);

    const competitionId = toNumber(
        game.competitionId ||
        (game.competition && game.competition.id)
    );

    const sportId = toNumber(game.sportId);

    const status = toStringValue(
        game.statusText ||
        game.shortStatusText ||
        game.status ||
        ""
    );

    const shortStatus = toStringValue(
        game.shortStatusText ||
        game.statusText ||
        game.status ||
        ""
    );

    const homeName = toStringValue(home.name);
    const awayName = toStringValue(away.name);

    return {
        gameId: gameId,
        apiFixtureId: gameId,
        apiProvider: "365scores",

        sportId: sportId,
        competitionId: competitionId,

        home: homeName,
        away: awayName,

        homeCompetitorId: toNumber(home.id),
        awayCompetitorId: toNumber(away.id),

        homeLogo: getCompetitorLogo(home),
        awayLogo: getCompetitorLogo(away),

        league: toStringValue(
            game.competitionDisplayName ||
            game.competitionName ||
            (game.competition && game.competition.name) ||
            ""
        ),

        date: getFirebaseDate(startTime),
        time: getFirebaseTime(startTime),

        timestamp: timestamp,
        matchTimeMillis: timestamp,

        score: getScore(home, away),

        status: status,
        shortStatus: shortStatus,

        round: toStringValue(game.roundName),
        stage: toStringValue(game.stageName),
        seasonNum: toNumber(game.seasonNum),

        stadium: toStringValue(
            game.venueName ||
            game.stadiumName ||
            ""
        ),

        goalEvents: normalizeGoalEvents(
            game.goalEvents
        ),

        streamUrl: ""
    };
}

function normalizeCompetition(item) {
    item = item || {};

    return {
        id: toNumber(item.id),
        competitionId: toNumber(item.id),
        sportId: toNumber(item.sportId),
        countryId: toNumber(item.countryId),

        name: toStringValue(
            item.name ||
            item.competitionDisplayName ||
            item.longName ||
            ""
        ),

        nameForURL: toStringValue(item.nameForURL),

        mainCompetitionId: toNumber(
            item.mainCompetitionId
        ),

        hideOnCatalog: item.hideOnCatalog === true,
        hideOnSearch: item.hideOnSearch === true,
        isInternational: item.isInternational === true,
        hasActiveGames: item.hasActiveGames === true,

        totalGames: toNumber(item.totalGames),
        liveGames: toNumber(item.liveGames),

        currentSeasonNum: toNumber(
            item.currentSeasonNum
        ),

        currentStageNum: toNumber(
            item.currentStageNum
        ),

        provider: "365scores"
    };
}

function normalizeSport(item) {
    item = item || {};

    return {
        id: toNumber(item.id),
        name: toStringValue(item.name),
        nameForURL: toStringValue(item.nameForURL),
        totalGames: toNumber(item.totalGames),
        liveGames: toNumber(item.liveGames),
        provider: "365scores"
    };
}

async function request(url, params) {
    const response = await axios.get(url, {
        params: getParams(params),
        timeout: 30000,
        headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0"
        }
    });

    return response.data || {};
}

/*
 * Fetch sports, countries and competitions catalog.
 */
async function fetchCatalog() {
    const data = await request(CATALOG_URL, {});

    return {
        sports: Array.isArray(data.sports)
            ? data.sports.map(normalizeSport)
            : [],

        countries: Array.isArray(data.countries)
            ? data.countries
            : [],

        competitions: Array.isArray(data.competitions)
            ? data.competitions.map(normalizeCompetition)
            : []
    };
}

/*
 * Fetch games for selected sports and date range.
 */
async function fetchMatches(options) {
    options = options || {};

    const sportIds = Array.isArray(options.sportIds)
        ? options.sportIds
        : [];

    const startDate = options.startDate;
    const endDate = options.endDate;

    if (!sportIds.length) {
        throw new Error(
            "No sports selected for 365Scores."
        );
    }

    if (!startDate || !endDate) {
        throw new Error(
            "startDate and endDate are required."
        );
    }

    const allMatches = [];
    const seen = {};

    for (let i = 0; i < sportIds.length; i++) {
        const sportId = toNumber(sportIds[i]);

        console.log(
            "Fetching 365Scores games for sport:",
            sportId
        );

        const data = await request(BASE_URL, {
            sports: sportId,
            startDate: startDate,
            endDate: endDate,
            showOdds: true
        });

        const games = Array.isArray(data.games)
            ? data.games
            : [];

        console.log(
            "Sport",
            sportId,
            "returned",
            games.length,
            "games"
        );

        games.forEach(function (game) {
            const match = normalizeMatch(game);

            if (!match.gameId || seen[match.gameId]) {
                return;
            }

            seen[match.gameId] = true;
            allMatches.push(match);
        });
    }

    return allMatches;
}

/*
 * Fetch details for one game.
 * Returns the original API response for inspection/use.
 */
async function fetchGameDetails(gameId) {
    if (
        gameId === undefined ||
        gameId === null ||
        String(gameId).trim() === ""
    ) {
        throw new Error("gameId is required.");
    }

    return await request(GAME_URL, {
        gameId: String(gameId)
    });
}

module.exports = {
    providerName: "365scores",
    fetchCatalog: fetchCatalog,
    fetchMatches: fetchMatches,
    fetchGameDetails: fetchGameDetails,
    normalizeMatch: normalizeMatch
};
