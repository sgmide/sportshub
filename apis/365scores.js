
"use strict";

const axios = require("axios");

const API_URL = "https://webws.365scores.com/web/games/";
const IMAGE_URL =
    "https://imagecache.365scores.com/image/upload/f_auto,w_120,h_120,c_limit,q_auto:eco/v2/competitors/";

function formatApiDate(isoDate) {
    const p = isoDate.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
}

function toMillis(value) {
    if (value == null) return 0;

    if (typeof value === "number") {
        return value < 100000000000 ? value * 1000 : value;
    }

    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
        return n < 100000000000 ? n * 1000 : n;
    }

    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(millis, timezone) {
    const date = new Date(millis || Date.now());

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(date);

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
        }).format(date)
    };
}

function getStatus(game) {
    const raw = String(
        game.statusText ||
        game.status ||
        game.gameStatus ||
        ""
    ).toUpperCase();

    if (raw.indexOf("POSTPON") >= 0 || raw === "PPD") {
        return ["Postponed", "PPD"];
    }

    if (raw.indexOf("CANCEL") >= 0 || raw === "CANC") {
        return ["Cancelled", "CANC"];
    }

    if (raw.indexOf("ABANDON") >= 0 || raw === "ABD") {
        return ["Abandoned", "ABD"];
    }

    if (raw.indexOf("PEN") >= 0) return ["Penalties", "AP"];
    if (raw === "HT" || raw.indexOf("HALF TIME") >= 0) {
        return ["Half Time", "HT"];
    }

    if (
        raw === "FT" ||
        raw.indexOf("FINISHED") >= 0 ||
        raw.indexOf("ENDED") >= 0
    ) {
        return ["Finished", "FT"];
    }

    const minute = Number(
        game.gameTime || game.currentPeriod || game.minute
    );

    if (
        game.isLive === true ||
        game.statusGroup === "LIVE" ||
        (Number.isFinite(minute) && minute > 0 && raw !== "FT")
    ) {
        return ["Live", raw || "LIVE"];
    }

    return [game.statusText || "Upcoming", raw || "NS"];
}

async function fetch(isoDate, options) {
    const settings = options.settings || {};
    const selectedParser = settings.selected_parser || "parse1";
    const parser = settings.parse && settings.parse[selectedParser]
        ? settings.parse[selectedParser] : {};

    const configuredUrl = parser.api_url || settings.api_url || API_URL;

    const sportsSetting = settings.selected_sports;
    let sportIds = [];

    if (Array.isArray(sportsSetting)) {
        sportIds = sportsSetting;
    } else if (sportsSetting && typeof sportsSetting === "object") {
        sportIds = Object.keys(sportsSetting).filter(function (id) {
            return sportsSetting[id] === true;
        });
    }

    if (!sportIds.length) {
        sportIds = [settings.selected_sport || 1];
    }

    const startDate = formatApiDate(isoDate);

    const dateObject = new Date(isoDate + "T00:00:00Z");
    dateObject.setUTCDate(dateObject.getUTCDate() + 1);

    const endDate = formatApiDate(
        dateObject.toISOString().slice(0, 10)
    );

    const results = [];

    for (const sportId of sportIds) {
        const response = await axios.get(configuredUrl, {
            timeout: 30000,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Referer": "https://www.365scores.com/",
                "Origin": "https://www.365scores.com"
            },
            params: {
                appTypeId: 5,
                langId: 1,
                timezoneName: options.timezone,
                userCountryId: 113,
                sports: sportId,
                startDate: startDate,
                endDate: endDate,
                showOdds: true,
                onlyMajorGames: false,
                withTop: true
            }
        });

        const data = response.data || {};

        if (!Array.isArray(data.games)) {
            throw new Error("365Scores response has no games array");
        }

        results.push.apply(results, data.games);
    }

    return results;
}

function normalize(game) {
    const id = game.id;
    if (id == null) return null;

    const home = game.homeCompetitor || {};
    const away = game.awayCompetitor || {};

    const millis = toMillis(
        game.startTime || game.startTimestamp || game.timestamp
    );

    const formatted = formatDateTime(millis, "Asia/Kolkata");

    const homeScore = home.score;
    const awayScore = away.score;

    const scoresAvailable =
        homeScore != null && awayScore != null;

    const status = getStatus(game);

    const competition = game.competition || {};

    const homeId = home.id;
    const awayId = away.id;

    return {
        gameId: String(id),
        fixtureId: String(id),
        apiFixtureId: String(id),
        apiProvider: "365scores",

        sportId: Number(game.sportId || 1),
        competitionId: String(
            game.competitionId ||
            competition.id ||
            ""
        ),

        league: String(
            game.competitionDisplayName ||
            game.competitionName ||
            competition.name ||
            "Unknown Competition"
        ),

        country: String(
            game.countryName ||
            (competition.country || {}).name ||
            ""
        ),

        home: String(home.name || "Home"),
        away: String(away.name || "Away"),

        homeLogo: homeId ? IMAGE_URL + homeId + ".png" : "",
        awayLogo: awayId ? IMAGE_URL + awayId + ".png" : "",

        homeScore: scoresAvailable ? homeScore : null,
        awayScore: scoresAvailable ? awayScore : null,

        score: scoresAvailable
            ? homeScore + " - " + awayScore
            : "VS",

        status: status[0],
        shortStatus: status[1],

        date: formatted.date,
        time: formatted.time,
        timestamp: Math.floor(millis / 1000),
        matchTimeMillis: millis,

        stadium: String(
            game.venueName ||
            (game.venue || {}).name ||
            ""
        ),

        streamUrl: "",
        updatedAt: Date.now()
    };
}

module.exports = {
    fetch: fetch,
    normalize: normalize
};
