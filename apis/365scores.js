
"use strict";

const axios = require("axios");

const BASE_URL = "https://webws.365scores.com/web/games/";
const CATALOG_URL = "https://webws.365scores.com/web/sports/";

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
    const number = Number(value);
    return Number.isFinite(number) ? number : (fallback || 0);
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

    return values.day + "/" + values.month + "/" + values.year;
}

function normalizeCompetition(item) {
    return {
        id: toNumber(item.id),
        sportId: toNumber(item.sportId),
        countryId: toNumber(item.countryId),
        name: String(
            item.name ||
            item.competitionDisplayName ||
            item.longName ||
            ""
        ),
        nameForURL: String(item.nameForURL || ""),
        mainCompetitionId: toNumber(item.mainCompetitionId),
        hideOnCatalog: item.hideOnCatalog === true,
        hideOnSearch: item.hideOnSearch === true,
        isInternational: item.isInternational === true,
        hasActiveGames: item.hasActiveGames === true,
        totalGames: toNumber(item.totalGames),
        liveGames: toNumber(item.liveGames),
        currentSeasonNum: toNumber(item.currentSeasonNum),
        currentStageNum: toNumber(item.currentStageNum),
        provider: "365scores"
    };
}

function normalizeSport(item) {
    return {
        id: toNumber(item.id),
        name: String(item.name || ""),
        nameForURL: String(item.nameForURL || ""),
        totalGames: toNumber(item.totalGames),
        liveGames: toNumber(item.liveGames),
        provider: "365scores"
    };
}

function normalizeMatch(game) {
    const home = game.homeCompetitor || {};
    const away = game.awayCompetitor || {};

    const startTime = game.startTime || "";
    const timestamp = startTime
        ? new Date(startTime).getTime()
        : 0;

    const competitionId = toNumber(game.competitionId);
    const sportId = toNumber(game.sportId);

    return {
        gameId: String(game.id || game.gameId || ""),
        apiFixtureId: String(game.id || game.gameId || ""),
        apiProvider: "365scores",

        sportId: sportId,
        competitionId: competitionId,
        competitionName: String(
            game.competitionDisplayName ||
            game.competitionName ||
            ""
        ),

        homeTeam: String(home.name || ""),
        awayTeam: String(away.name || ""),

        homeTeamId: toNumber(home.id),
        awayTeamId: toNumber(away.id),

        homeLogo: home.imageVersion
            ? "https://imagecache.365scores.com/image/upload/f_png,w_100,h_100,c_limit,q_auto:eco,dpr_2/competitors/" +
                home.id
            : "",

        awayLogo: away.imageVersion
            ? "https://imagecache.365scores.com/image/upload/f_png,w_100,h_100,c_limit,q_auto:eco,dpr_2/competitors/" +
                away.id
            : "",

        homeScore: home.score == null ? "" : home.score,
        awayScore: away.score == null ? "" : away.score,

        timestamp: timestamp,
        matchTimeMillis: timestamp,
        startTime: startTime,

        status: String(
            game.statusText ||
            game.shortStatusText ||
            ""
        ),

        shortStatus: String(
            game.shortStatusText ||
            game.statusText ||
            ""
        ),

        round: String(game.roundName || ""),
        stage: String(game.stageName || ""),
        seasonNum: toNumber(game.seasonNum),

        streamUrl: ""
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
 * Catalog endpoint:
 * Returns the catalog data that the endpoint actually provides.
 * The endpoint may not contain every competition.
 */
async function fetchCatalog() {
    try {
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
    } catch (error) {
        console.log(
            "365Scores catalog endpoint failed:",
            error.message
        );

        return {
            sports: [],
            countries: [],
            competitions: []
        };
    }
}

/*
 * Fetch games for selected sports and dates.
 */
async function fetchMatches(options) {
    options = options || {};

    const sportIds = Array.isArray(options.sportIds)
        ? options.sportIds
        : [];

    const startDate = options.startDate;
    const endDate = options.endDate;

    if (!sportIds.length) {
        throw new Error("No sports selected for 365Scores.");
    }

    if (!startDate || !endDate) {
        throw new Error("startDate and endDate are required.");
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

module.exports = {
    providerName: "365scores",
    fetchCatalog: fetchCatalog,
    fetchMatches: fetchMatches
};
