
"use strict";

const axios = require("axios");

const API_URL = "https://webws.365scores.com/web/games/";
const TIME_ZONE = "Asia/Kolkata";

function formatDate(dateString) {
    const parts = dateString.split("-");
    return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function getSports(settings) {
    const selected = settings.selected_sports;

    if (Array.isArray(selected)) {
        const ids = selected
            .map(Number)
            .filter(Number.isFinite);

        if (ids.length) return ids;
    }

    if (selected && typeof selected === "object") {
        const ids = Object.keys(selected)
            .filter(function (key) {
                return selected[key] === true;
            })
            .map(Number)
            .filter(Number.isFinite);

        if (ids.length) return ids;
    }

    return [Number(settings.selected_sport) || 1];
}

async function fetch(date, options) {
    const settings = options.settings || {};
    const parserSettings =
        settings.parse &&
        settings.selected_parser &&
        settings.parse[settings.selected_parser]
            ? settings.parse[settings.selected_parser]
            : {};

    const apiUrl = parserSettings.api_url ||
        settings.api_url ||
        API_URL;

    const sports = getSports(settings);
    const allGames = [];

    for (const sportId of sports) {
        const response = await axios.get(apiUrl, {
            timeout: 30000,
            params: {
                appTypeId: 5,
                langId: 1,
                timezoneName: options.timezone || TIME_ZONE,
                userCountryId: 113,
                sports: sportId,
                startDate: formatDate(date),
                endDate: formatDate(date),
                showOdds: true,
                onlyMajorGames: false,
                withTop: true
            },
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
                "Accept": "application/json, text/plain, */*",
                "Referer": "https://www.365scores.com/",
                "Origin": "https://www.365scores.com"
            }
        });

        const data = response.data || {};

        if (!Array.isArray(data.games)) {
            throw new Error(
                "365Scores response did not contain games array"
            );
        }

        allGames.push.apply(allGames, data.games);
    }

    return allGames;
}

function getTimestamp(game) {
    const value =
        game.startTime ||
        game.startTimestamp ||
        game.startDate ||
        game.date;

    if (typeof value === "number") {
        return value < 1000000000000 ? value * 1000 : value;
    }

    if (value) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }

    return 0;
}

function getStatus(game) {
    const statusObj = game.status || {};
    const statusText = String(
        statusObj.name ||
        statusObj.longName ||
        game.statusText ||
        game.statusDescription ||
        ""
    );

    const upper = statusText.toUpperCase();
    const gameStatus = Number(game.statusGroup || game.statusId || 0);

    if (upper.indexOf("POSTPON") >= 0) return ["PPD", "PPD"];
    if (upper.indexOf("CANCEL") >= 0) return ["CANC", "CANC"];
    if (upper.indexOf("ABANDON") >= 0) return ["ABD", "ABD"];
    if (upper.indexOf("HALF") >= 0) return ["HT", "HT"];
    if (upper.indexOf("FINISHED") >= 0 ||
        upper === "FT" ||
        upper.indexOf("ENDED") >= 0) {
        return ["FT", "FT"];
    }

    if (
        gameStatus === 2 ||
        gameStatus === 3 ||
        upper.indexOf("LIVE") >= 0 ||
        upper.indexOf("IN PLAY") >= 0
    ) {
        return ["LIVE", "LIVE"];
    }

    return ["UPCOMING", "NS"];
}

function normalize(game) {
    const competitors = Array.isArray(game.competitors)
        ? game.competitors
        : [];

    const home = competitors.find(function (team) {
        return String(team.position || team.qualifier || "")
            .toLowerCase() === "home";
    }) || competitors[0] || {};

    const away = competitors.find(function (team) {
        return String(team.position || team.qualifier || "")
            .toLowerCase() === "away";
    }) || competitors[1] || {};

    const competition = game.competition || {};
    const country = game.country || {};
    const timestamp = getTimestamp(game);
    const status = getStatus(game);

    const homeName =
        home.name ||
        home.shortName ||
        home.competitorName ||
        "";

    const awayName =
        away.name ||
        away.shortName ||
        away.competitorName ||
        "";

    const homeScore = home.score != null
        ? home.score
        : home.currentScore;

    const awayScore = away.score != null
        ? away.score
        : away.currentScore;

    const hasScore =
        homeScore != null && awayScore != null;

    return {
        gameId: String(game.id || game.gameId || ""),
        fixtureId: String(game.id || game.gameId || ""),
        apiFixtureId: String(game.id || game.gameId || ""),
        apiProvider: "365scores",
        sportId: Number(game.sportId || game.sport || 1),
        competitionId: String(
            game.competitionId ||
            competition.id ||
            ""
        ),
        league:
            game.competitionDisplayName ||
            game.competitionName ||
            competition.name ||
            "Unknown competition",
        country: country.name || game.countryName || "",
        season: "",
        home: homeName,
        away: awayName,
        homeLogo:
            home.imageVersion
                ? "https://imagecache.365scores.com/image/upload/f_auto,w_120,h_120,c_limit,q_auto:eco/v2/competitors/" +
                  home.id
                : "",
        awayLogo:
            away.imageVersion
                ? "https://imagecache.365scores.com/image/upload/f_auto,w_120,h_120,c_limit,q_auto:eco/v2/competitors/" +
                  away.id
                : "",
        homeScore: homeScore == null ? null : Number(homeScore),
        awayScore: awayScore == null ? null : Number(awayScore),
        score: hasScore
            ? String(homeScore) + " - " + String(awayScore)
            : "VS",
        status: status[0],
        shortStatus: status[1],
        elapsed: game.time || game.minute || "",
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
        stadium:
            (game.venue && game.venue.name) ||
            game.venueName ||
            "",
        streamUrl: ""
    };
}

module.exports = {
    fetch: fetch,
    normalize: normalize
};
