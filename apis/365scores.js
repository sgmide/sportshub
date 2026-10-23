
"use strict";

const admin = require("firebase-admin");
const https = require("https");

const PROVIDER = "365scores";
const DEFAULT_API_URL = "https://webws.365scores.com/web/games/";
const TIME_ZONE = "Asia/Kolkata";

function initFirebase() {
    if (!admin.apps.length) {
        const serviceAccount = JSON.parse(
            process.env.FIREBASE_SERVICE_ACCOUNT || "{}"
        );

        if (Object.keys(serviceAccount).length === 0) {
            throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL
        });
    }

    return admin.database();
}

function requestJson(url) {
    return new Promise(function (resolve, reject) {
        const request = https.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json"
            },
            timeout: 30000
        }, function (response) {
            let body = "";

            response.on("data", function (chunk) {
                body += chunk;
            });

            response.on("end", function () {
                if (response.statusCode < 200 ||
                    response.statusCode >= 300) {
                    reject(new Error(
                        "365Scores HTTP " + response.statusCode
                    ));
                    return;
                }

                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error("Invalid 365Scores JSON"));
                }
            });
        });

        request.on("timeout", function () {
            request.destroy(new Error("365Scores request timeout"));
        });

        request.on("error", reject);
    });
}

function getDate(offset) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    let values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    return values.year + "-" + values.month + "-" + values.day;
}

function getSelectedSports(settings) {
    const result = [];
    const sports = settings.selected_sports || settings.sports || {};

    if (Array.isArray(sports)) {
        sports.forEach(function (item) {
            const id = typeof item === "object"
                ? item.id || item.sportId
                : item;

            if (id !== undefined && id !== null) {
                result.push(String(id));
            }
        });
    } else {
        Object.keys(sports).forEach(function (key) {
            const item = sports[key];

            if (item === true) {
                result.push(String(key));
            } else if (item && typeof item === "object" &&
                       item.selected !== false) {
                result.push(String(item.id || item.sportId || key));
            }
        });
    }

    if (result.length === 0) {
        return ["1"];
    }

    return result;
}

function getGames(json) {
    if (Array.isArray(json.games)) {
        return json.games;
    }

    if (json.games && Array.isArray(json.games.games)) {
        return json.games.games;
    }

    if (json.games && Array.isArray(json.games.items)) {
        return json.games.items;
    }

    return [];
}

function getCompetition(game) {
    const comp = game.competition || game.league || {};
    const id = comp.id || comp.competitionId ||
        game.competitionId || game.leagueId;

    if (id === undefined || id === null) {
        return null;
    }

    return {
        id: String(id),
        name: comp.name || comp.shortName || game.competitionName ||
            game.leagueName || "Competition",
        country: comp.countryName || comp.country || "",
        logo: comp.logo || comp.image || comp.flag || "",
        sportId: String(game.sportId || comp.sportId || "1")
    };
}

function getTeam(game, home) {
    const team = home
        ? game.homeCompetitor || game.homeTeam || game.home
        : game.awayCompetitor || game.awayTeam || game.away;

    if (!team) {
        return {};
    }

    return {
        id: String(team.id || team.competitorId || ""),
        name: team.name || team.shortName || team.displayName || "",
        logo: team.logo || team.image || team.crest || ""
    };
}

function getScore(game, home) {
    const team = home
        ? game.homeCompetitor || game.homeTeam || game.home
        : game.awayCompetitor || game.awayTeam || game.away;

    if (team && team.score !== undefined && team.score !== null) {
        return Number(team.score);
    }

    const score = home ? game.homeScore : game.awayScore;

    if (score !== undefined && score !== null) {
        return Number(score);
    }

    return 0;
}

function getStatus(game) {
    const status = game.status || game.gameStatus || {};
    const text = typeof status === "string"
        ? status
        : status.text || status.name || status.shortName || "";

    const minute = game.gameTime || game.minute ||
        game.currentPeriod || "";

    const normalized = String(text).toUpperCase();

    if (normalized.indexOf("FINISHED") !== -1 ||
        normalized === "FT" || normalized === "ENDED") {
        return { status: "FT", shortStatus: "FT" };
    }

    if (normalized.indexOf("POSTPON") !== -1 ||
        normalized === "PPD") {
        return { status: "PPD", shortStatus: "PPD" };
    }

    if (normalized.indexOf("CANCEL") !== -1 ||
        normalized === "CANC") {
        return { status: "CANC", shortStatus: "CANC" };
    }

    if (normalized.indexOf("LIVE") !== -1 ||
        normalized.indexOf("IN PROGRESS") !== -1 ||
        normalized === "1H" || normalized === "2H" ||
        normalized === "HT" || normalized === "ET" ||
        normalized === "PEN" || minute) {
        return {
            status: minute ? String(minute) : "LIVE",
            shortStatus: "LIVE"
        };
    }

    return {
        status: text || "NS",
        shortStatus: "NS"
    };
}

function getTimestamp(game) {
    const value = game.startTime || game.startDate ||
        game.date || game.gameDate || game.startTimeUTC;

    if (typeof value === "number") {
        return value > 9999999999 ? value : value * 1000;
    }

    if (value) {
        const parsed = new Date(value).getTime();

        if (!isNaN(parsed)) {
            return parsed;
        }
    }

    return Date.now();
}

function encodeQuery(params) {
    return Object.keys(params).map(function (key) {
        return encodeURIComponent(key) + "=" +
            encodeURIComponent(params[key]);
    }).join("&");
}

async function fetchDate(date, sportId, apiUrl) {
    const params = {
        date: date,
        sportId: sportId,
        appTypeId: 5,
        langId: 1,
        timezoneName: TIME_ZONE,
        userCountryId:  INFINITY_COUNTRY_ID
    };

    const url = apiUrl + "?" + encodeQuery(params);
    const json = await requestJson(url);

    return getGames(json);
}

const INFINITY_COUNTRY_ID = 1;

async function main() {
    const db = initFirebase();

    const settingsSnapshot = await db.ref("settings").once("value");
    const settings = settingsSnapshot.val() || {};

    const selectionSnapshot = await db.ref("competition_selection")
        .once("value");
    const selection = selectionSnapshot.val() || {};

    const oldProviderSnapshot = await db.ref(
        "settings/last_synced_api_provider"
    ).once("value");

    const oldProvider = String(oldProviderSnapshot.val() || "")
        .toLowerCase();

    const providerChanged = oldProvider !== PROVIDER;

    const apiUrl = settings.api_url_365scores ||
        settings.api_url || DEFAULT_API_URL;

    const sports = getSelectedSports(settings);
    const dates = [getDate(-1), getDate(0), getDate(1)];

    const allGames = [];
    let failedRequests = 0;

    for (let s = 0; s < sports.length; s++) {
        for (let d = 0; d < dates.length; d++) {
            try {
                const games = await fetchDate(
                    dates[d],
                    sports[s],
                    apiUrl
                );

                games.forEach(function (game) {
                    allGames.push({
                        game: game,
                        requestedSportId: sports[s]
                    });
                });
            } catch (error) {
                failedRequests++;
                console.error(
                    "365Scores fetch failed:",
                    dates[d],
                    sports[s],
                    error.message
                );
            }
        }
    }

    if (failedRequests > 0) {
        throw new Error(
            "Some 365Scores requests failed. Firebase was not replaced."
        );
    }

    if (allGames.length === 0) {
        throw new Error(
            "365Scores returned no games. Firebase was not replaced."
        );
    }

    const competitions = {};
    const matches = {};

    allGames.forEach(function (entry) {
        const game = entry.game;
        const comp = getCompetition(game);

        if (!comp) {
            return;
        }

        const gameId = game.id || game.gameId || game.eventId;

        if (gameId === undefined || gameId === null) {
            return;
        }

        const compId = comp.id;
        const selected = selection[compId] === true;

        competitions[compId] = {
            id: compId,
            sportId: comp.sportId || entry.requestedSportId,
            name: comp.name,
            country: comp.country,
            logo: comp.logo,
            apiProvider: PROVIDER,
            selected: selected
        };

        if (!selected) {
            return;
        }

        const home = getTeam(game, true);
        const away = getTeam(game, false);
        const status = getStatus(game);
        const timestamp = getTimestamp(game);

        matches[String(gameId)] = {
            gameId: String(gameId),
            apiFixtureId: String(gameId),
            apiProvider: PROVIDER,
            competitionId: compId,
            competitionName: comp.name,
            league: comp.name,
            homeTeam: home.name || "Home",
            awayTeam: away.name || "Away",
            homeTeamId: home.id,
            awayTeamId: away.id,
            homeLogo: home.logo,
            awayLogo: away.logo,
            homeScore: getScore(game, true),
            awayScore: getScore(game, false),
            timestamp: timestamp,
            matchTimeMillis: timestamp,
            status: status.status,
            shortStatus: status.shortStatus,
            streamUrl: "",
            sportId: comp.sportId || entry.requestedSportId
        };
    });

    const updates = {};
    const oldMatchesSnapshot = await db.ref("matches").once("value");
    const oldMatches = oldMatchesSnapshot.val() || {};

    if (providerChanged) {
        updates["matches"] = matches;
        updates["competitions"] = competitions;

        const newSelection = {};

        Object.keys(competitions).forEach(function (id) {
            newSelection[id] = false;
        });

        updates["competition_selection"] = newSelection;
        updates["settings/last_synced_api_provider"] = PROVIDER;

        console.log("Provider changed. Saved new provider data.");
        console.log("Matches saved:", Object.keys(matches).length);
        console.log("Competitions discovered:",
            Object.keys(competitions).length);

        await db.ref().update(updates);
        return;
    }

    Object.keys(matches).forEach(function (id) {
        const previous = oldMatches[id] || {};

        matches[id].streamUrl = previous.streamUrl || "";
        if (previous.goalEvents !== undefined) {
            matches[id].goalEvents = previous.goalEvents;
        }
        if (previous.adminNotes !== undefined) {
            matches[id].adminNotes = previous.adminNotes;
        }

        updates["matches/" + id] = matches[id];
    });

    Object.keys(competitions).forEach(function (id) {
        updates["competitions/" + id] = competitions[id];

        if (selection[id] === undefined) {
            updates["competition_selection/" + id] = false;
        }
    });

    updates["settings/last_synced_api_provider"] = PROVIDER;

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
    }

    console.log("365Scores sync completed.");
    console.log("Selected matches updated:", Object.keys(matches).length);
    console.log("Competitions discovered:", Object.keys(competitions).length);
}

main().catch(function (error) {
    console.error("365Scores sync error:", error);
    process.exit(1);
});
