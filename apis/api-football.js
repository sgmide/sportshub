
"use strict";

const axios = require("axios");

function getApiKey(settings) {
    settings = settings || {};

    return process.env.API_FOOTBALL_KEY ||
        process.env.APISPORTS_KEY ||
        settings.apiFootballKey ||
        "";
}

function getFixturesUrl(parserSettings) {
    parserSettings = parserSettings || {};

    const configured =
        parserSettings.game_api_url ||
        parserSettings.api_url ||
        "https://v3.football.api-sports.io/fixtures";

    const url = String(configured).replace(/\/+$/, "");

    return /\/fixtures$/i.test(url)
        ? url
        : url + "/fixtures";
}

function toMillis(value) {
    if (value == null || value === "") return 0;

    if (typeof value === "number") {
        return value < 1000000000000
            ? value * 1000
            : value;
    }

    const parsed = Date.parse(value);

    return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrZero(value) {
    if (value == null || value === "") return 0;

    const number = Number(value);

    return Number.isFinite(number) ? number : 0;
}

function normalize(fixture) {
    if (!fixture || !fixture.fixture ||
            fixture.fixture.id == null) {
        return null;
    }

    const info = fixture.fixture;
    const league = fixture.league || {};
    const teams = fixture.teams || {};
    const goals = fixture.goals || {};
    const scores = fixture.score || {};
    const home = teams.home || {};
    const away = teams.away || {};
    const statusInfo = info.status || {};

    const status = statusInfo.short || "NS";
    const elapsed = statusInfo.elapsed;

    const liveStatuses = [
        "1H", "2H", "HT", "ET", "BT",
        "P", "LIVE"
    ];

    const displayStatus =
        elapsed != null && liveStatuses.indexOf(status) !== -1
            ? String(elapsed) + "'"
            : status;

    const halftime = scores.halftime || {};
    const fulltime = scores.fulltime || {};
    const extratime = scores.extratime || {};
    const penalty = scores.penalty || {};

    const timestamp = toMillis(info.date);

    const venue = info.venue || {};

    return {
        gameId: Number(info.id),
        apiFixtureId: Number(info.id),
        apiProvider: "api-football",

        competitionId: numberOrZero(league.id),
        competitionName: league.name || "",
        sportId: 1,

        homeCompetitorId: numberOrZero(home.id),
        awayCompetitorId: numberOrZero(away.id),

        homeTeam: home.name || "Home",
        awayTeam: away.name || "Away",

        homeLogo: home.logo || "",
        awayLogo: away.logo || "",

        homeScore: numberOrZero(goals.home),
        awayScore: numberOrZero(goals.away),

        halftimeHomeScore: numberOrZero(halftime.home),
        halftimeAwayScore: numberOrZero(halftime.away),

        fulltimeHomeScore: numberOrZero(fulltime.home),
        fulltimeAwayScore: numberOrZero(fulltime.away),

        extratimeHomeScore: numberOrZero(extratime.home),
        extratimeAwayScore: numberOrZero(extratime.away),

        penaltyHomeScore: numberOrZero(penalty.home),
        penaltyAwayScore: numberOrZero(penalty.away),

        // Preserve event data when the provider supplies it.
        goalEvents: Array.isArray(fixture.goalEvents)
            ? fixture.goalEvents
            : [],

        timestamp: timestamp,
        matchTimeMillis: timestamp,

        status: displayStatus,
        shortStatus: status,

        round: league.round || "",
        season: numberOrZero(league.season),
        venue: venue.name || "",

        streamUrl: ""
    };
}

async function fetchMatches(options) {
    options = options || {};

    const date = options.date;
    const settings = options.settings || {};
    const parserSettings = options.parserSettings || {};

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Invalid date. Expected YYYY-MM-DD");
    }

    const apiKey = getApiKey(settings);

    if (!apiKey) {
        throw new Error("API_FOOTBALL_KEY secret is missing");
    }

    const url = getFixturesUrl(parserSettings);

    const response = await axios.get(url, {
        timeout: 30000,
        params: {
            date: date,
            timezone: "Asia/Kolkata"
        },
        headers: {
            "x-apisports-key": apiKey,
            "Accept": "application/json"
        }
    });

    const data = response.data || {};

    if (data.errors &&
            Object.keys(data.errors).length > 0) {
        throw new Error(
            "API-Football error: " +
            JSON.stringify(data.errors)
        );
    }

    if (!Array.isArray(data.response)) {
        throw new Error("Unexpected API-Football response");
    }

    const unique = Object.create(null);

    data.response.forEach(function (fixture) {
        const match = normalize(fixture);

        if (match) {
            unique[String(match.gameId)] = match;
        }
    });

    const matches = Object.keys(unique).map(function (id) {
        return unique[id];
    });

    console.log(
        "API-Football " + date +
        ": " + matches.length + " fixtures"
    );

    return matches;
}

module.exports = {
    fetchMatches: fetchMatches
};
