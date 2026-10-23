
"use strict";

const axios = require("axios");

const API_URL = "https://v3.football.api-sports.io/fixtures";
const TIME_ZONE = "Asia/Kolkata";

async function fetch(date, options) {
    const apiKey = process.env.API_FOOTBALL_KEY;

    if (!apiKey) {
        throw new Error("Missing API_FOOTBALL_KEY secret");
    }

    const response = await axios.get(API_URL, {
        timeout: 30000,
        params: {
            date: date,
            timezone: options.timezone || TIME_ZONE
        },
        headers: {
            "x-apisports-key": apiKey
        }
    });

    const data = response.data || {};

    if (data.errors && Object.keys(data.errors).length) {
        throw new Error(
            "API-Football error: " +
            JSON.stringify(data.errors)
        );
    }

    if (!Array.isArray(data.response)) {
        throw new Error(
            "API-Football response array is missing"
        );
    }

    return data.response;
}

function normalize(item) {
    const fixture = item.fixture || {};
    const league = item.league || {};
    const teams = item.teams || {};
    const goals = item.goals || {};
    const home = teams.home || {};
    const away = teams.away || {};
    const statusData = fixture.status || {};

    const short = String(statusData.short || "NS");
    const elapsed = statusData.elapsed;

    let status = "UPCOMING";

    if (["1H", "2H", "ET", "P", "LIVE"].indexOf(short) >= 0) {
        status = "LIVE";
    } else if (short === "HT") {
        status = "HT";
    } else if (short === "FT" || short === "AET" || short === "PEN") {
        status = "FT";
    } else if (short === "PST" || short === "SUSP") {
        status = "PPD";
    } else if (short === "CANC") {
        status = "CANC";
    } else if (short === "ABD") {
        status = "ABD";
    } else if (short === "AWD" || short === "WO") {
        status = "FT";
    }

    const timestamp = fixture.timestamp
        ? Number(fixture.timestamp) * 1000
        : (Date.parse(fixture.date || "") || 0);

    const hasScore =
        goals.home != null && goals.away != null;

    return {
        gameId: String(fixture.id || ""),
        fixtureId: String(fixture.id || ""),
        apiFixtureId: String(fixture.id || ""),
        apiProvider: "api-football",
        sportId: 1,
        competitionId: String(league.id || ""),
        league: league.name || "Unknown competition",
        country: league.country || "",
        season: league.season || "",
        home: home.name || "",
        away: away.name || "",
        homeLogo: home.logo || "",
        awayLogo: away.logo || "",
        homeScore: goals.home == null ? null : Number(goals.home),
        awayScore: goals.away == null ? null : Number(goals.away),
        score: hasScore
            ? String(goals.home) + " - " + String(goals.away)
            : "VS",
        status: status,
        shortStatus: short,
        elapsed: elapsed == null ? "" : elapsed,
        date: timestamp
            ? new Intl.DateTimeFormat("en-GB", {
                  timeZone: TIME_ZONE,
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric"
              }).format(new Date(timestamp))
            : "",
        time: timestamp
            ? new Intl.DateTimeFormat("en-GB", {
                  timeZone: TIME_ZONE,
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false
              }).format(new Date(timestamp))
            : "",
        timestamp: timestamp,
        matchTimeMillis: timestamp,
        stadium: fixture.venue && fixture.venue.name
            ? fixture.venue.name
            : "",
        streamUrl: ""
    };
}

module.exports = {
    fetch: fetch,
    normalize: normalize
};
