
"use strict";

const axios = require("axios");

const API_URL = "https://v3.football.api-sports.io/fixtures";

function formatDateTime(date, timezone) {
    const d = new Date(date);

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(d);

    const v = {};
    parts.forEach(function (p) {
        v[p.type] = p.value;
    });

    return {
        date: v.day + "-" + v.month + "-" + v.year,
        time: new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).format(d)
    };
}

function getStatus(shortStatus, longStatus) {
    const status = String(shortStatus || "").toUpperCase();

    if (["1H", "2H", "ET", "BT", "P", "LIVE"].includes(status)) {
        return ["Live", status];
    }

    const map = {
        NS: ["Upcoming", "NS"],
        HT: ["Half Time", "HT"],
        FT: ["Finished", "FT"],
        AET: ["After Extra Time", "AET"],
        PEN: ["After Penalties", "PEN"],
        PST: ["Postponed", "PST"],
        CANC: ["Cancelled", "CANC"],
        ABD: ["Abandoned", "ABD"],
        SUSP: ["Suspended", "SUSP"],
        INT: ["Interrupted", "INT"]
    };

    return map[status] || [
        longStatus || "Upcoming",
        status || "NS"
    ];
}

async function fetch(date, options) {
    const apiKey = process.env.API_FOOTBALL_KEY;

    if (!apiKey) {
        throw new Error("Missing API_FOOTBALL_KEY GitHub Secret");
    }

    const response = await axios.get(API_URL, {
        timeout: 30000,
        headers: {
            "x-apisports-key": apiKey
        },
        params: {
            date: date,
            timezone: options.timezone
        }
    });

    const data = response.data || {};

    if (data.errors && Object.keys(data.errors).length) {
        throw new Error("API-Football error: " +
            JSON.stringify(data.errors));
    }

    if (!Array.isArray(data.response)) {
        throw new Error("Invalid API-Football response");
    }

    return data.response;
}

function normalize(item) {
    const fixture = item.fixture || {};
    const league = item.league || {};
    const teams = item.teams || {};
    const goals = item.goals || {};
    const statusInfo = fixture.status || {};
    const venue = fixture.venue || {};

    const id = Number(fixture.id || 0);
    if (!id) return null;

    const timestamp = Number(fixture.timestamp || 0);
    const date = fixture.date ||
        (timestamp ? new Date(timestamp * 1000).toISOString() : "");

    const formatted = formatDateTime(
        date || new Date(),
        "Asia/Kolkata"
    );

    const home = teams.home || {};
    const away = teams.away || {};

    const homeScore = goals.home == null ? null : goals.home;
    const awayScore = goals.away == null ? null : goals.away;

    const hasScore = homeScore != null && awayScore != null;
    const status = getStatus(statusInfo.short, statusInfo.long);

    return {
        gameId: id,
        fixtureId: String(id),
        apiFixtureId: String(id),
        apiProvider: "apifootball",

        sportId: 1,
        competitionId: Number(league.id || 0),
        league: String(league.name || "Unknown Competition"),
        country: String(league.country || ""),
        season: league.season == null ? "" : String(league.season),

        home: String(home.name || "Home"),
        away: String(away.name || "Away"),
        homeLogo: String(home.logo || ""),
        awayLogo: String(away.logo || ""),

        homeScore: homeScore,
        awayScore: awayScore,
        score: hasScore ? homeScore + " - " + awayScore : "VS",

        status: status[0],
        shortStatus: status[1],
        elapsed: statusInfo.elapsed == null ? 0 : statusInfo.elapsed,

        date: formatted.date,
        time: formatted.time,
        timestamp: timestamp,
        matchTimeMillis: timestamp * 1000,

        stadium: String(venue.name || ""),
        streamUrl: "",
        updatedAt: Date.now()
    };
}

module.exports = {
    fetch: fetch,
    normalize: normalize
};
