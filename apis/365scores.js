"use strict";

const admin = require("firebase-admin");
const axios = require("axios");

const PROVIDER = "365scores";
const API_URL = "https://webws.365scores.com/web/games/";
const IMAGE_URL = "https://imagecache.365scores.com/image/upload/";

const TIME_ZONE = "Asia/Kolkata";
const DATE_RANGE = 1;
const REQUEST_TIMEOUT = 30000;
const REQUEST_DELAY = 500;

const FIREBASE_SERVICE_ACCOUNT =
    process.env.FIREBASE_SERVICE_ACCOUNT;

const FIREBASE_DATABASE_URL =
    process.env.FIREBASE_DATABASE_URL;

const API_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.365scores.com/"
};

const DEFAULT_SPORTS = {
    "01": {
        id: 1,
        name: "Football",
        nameForURL: "football",
        drawSupport: true,
        imageVersion: 1,
        liveGames: 0,
        totalGames: 0
    },
    "02": {
        id: 2,
        name: "Basketball",
        nameForURL: "basketball",
        drawSupport: false,
        imageVersion: 1,
        liveGames: 0,
        totalGames: 0
    },
    "03": {
        id: 3,
        name: "Tennis",
        nameForURL: "tennis",
        drawSupport: false,
        imageVersion: 1,
        liveGames: 0,
        totalGames: 0
    },
    "04": {
        id: 4,
        name: "Hockey",
        nameForURL: "hockey",
        drawSupport: false,
        imageVersion: 1,
        liveGames: 0,
        totalGames: 0
    },
    "05": {
        id: 5,
        name: "Handball",
        nameForURL: "handball",
        drawSupport: false,
        imageVersion: 1,
        liveGames: 0,
        totalGames: 0
    },
    "06": {
        id: 6,
        name: "A. Football",
        nameForURL: "american-football",
        drawSupport: false,
        imageVersion: 1,
        liveGames: 0,
        totalGames: 0
    },
    "07": {
        id: 7,
        name: "Baseball",
        nameForURL: "baseball",
        drawSupport: false,
        imageVersion: 1,
        liveGames: 0,
        totalGames: 0
    },
    "08": {
        id: 8,
        name: "Volleyball",
        nameForURL: "volleyball",
        drawSupport: false,
        imageVersion: 1,
        liveGames: 0,
        totalGames: 0
    },
    "09": {
        id: 9,
        name: "Rugby",
        nameForURL: "rugby",
        drawSupport: false,
        imageVersion: 1,
        liveGames: 0,
        totalGames: 0
    }
};

function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function text(value) {
    return value == null ? "" : String(value).trim();
}

function cleanKey(value) {
    return text(value).replace(/[.#$\[\]/]/g, "_");
}

function normalizeBoolean(value) {
    if (value === true || value === 1) return true;

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();

        return normalized === "true" ||
            normalized === "1" ||
            normalized === "yes";
    }

    return false;
}

function objectId(obj) {
    if (obj == null) return "";

    if (typeof obj !== "object") {
        return text(obj);
    }

    return text(
        obj.id ||
        obj.ID ||
        obj.competitorId ||
        obj.competitionId ||
        obj.tournamentId ||
        obj.leagueId ||
        obj.sportId ||
        obj.gameId ||
        obj.teamId ||
        obj.value ||
        ""
    );
}

function objectName(obj) {
    if (obj == null) return "";

    if (typeof obj !== "object") {
        return text(obj);
    }

    return text(
        obj.name ||
        obj.shortName ||
        obj.longName ||
        obj.displayName ||
        obj.title ||
        obj.value ||
        ""
    );
}

function timestamp() {
    return Date.now();
}

function dateString(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    let year = "";
    let month = "";
    let day = "";

    parts.forEach(function (part) {
        if (part.type === "year") year = part.value;
        if (part.type === "month") month = part.value;
        if (part.type === "day") day = part.value;
    });

    return year + "-" + month + "-" + day;
}

function displayDate(date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(date);

    let day = "";
    let month = "";
    let year = "";

    parts.forEach(function (part) {
        if (part.type === "day") day = part.value;
        if (part.type === "month") month = part.value;
        if (part.type === "year") year = part.value;
    });

    return day + "-" + month + "-" + year;
}

function getDates() {
    const result = [];
    const today = dateString(new Date());
    const base = new Date(today + "T12:00:00Z");

    for (let i = -DATE_RANGE; i <= DATE_RANGE; i++) {
        result.push(
            dateString(
                new Date(base.getTime() + i * 86400000)
            )
        );
    }

    return result;
}

function kickoff(game) {
    const fields = [
        game.startTime,
        game.startDate,
        game.startDateTime,
        game.dateTime,
        game.gameDate,
        game.kickoff,
        game.date
    ];

    for (let i = 0; i < fields.length; i++) {
        const value = fields[i];

        if (value == null || value === "") continue;

        let date;

        if (typeof value === "number") {
            date = new Date(
                value < 1000000000000
                    ? value * 1000
                    : value
            );
        } else {
            date = new Date(value);
        }

        if (!isNaN(date.getTime())) {
            return date;
        }
    }

    return null;
}

function fixtureId(game) {
    return text(
        game.id ||
        game.gameId ||
        game.gameID ||
        game.fixtureId ||
        game.eventId ||
        ""
    );
}

function teams(game) {
    return {
        home:
            game.homeCompetitor ||
            game.homeTeam ||
            game.home ||
            {},
        away:
            game.awayCompetitor ||
            game.awayTeam ||
            game.away ||
            {}
    };
}

function teamLogo(team) {
    if (!team || typeof team !== "object") {
        return "";
    }

    const direct =
        team.logo ||
        team.image ||
        team.imageUrl ||
        team.logoUrl ||
        team.picture ||
        team.pictureUrl;

    if (direct) return text(direct);

    const imageId =
        team.imageID ||
        team.imageId ||
        team.logoId ||
        team.pictureId;

    return imageId ? IMAGE_URL + imageId : "";
}

function scoreFor(game, side) {
    const names = side === "home"
        ? ["homeCompetitor", "homeTeam", "home"]
        : ["awayCompetitor", "awayTeam", "away"];

    for (let i = 0; i < names.length; i++) {
        const team = game[names[i]];

        if (team && typeof team === "object") {
            const value =
                team.score != null
                    ? team.score
                    : team.currentScore;

            if (value != null) return text(value);
        }
    }

    const candidates = side === "home"
        ? [game.homeScore, game.home_score, game.scoreHome]
        : [game.awayScore, game.away_score, game.scoreAway];

    for (let i = 0; i < candidates.length; i++) {
        if (candidates[i] != null) {
            return text(candidates[i]);
        }
    }

    return "";
}

function gameStatus(game) {
    const status =
        game.status ||
        game.gameStatus ||
        game.statusText ||
        "";

    if (typeof status === "object") {
        return text(
            status.shortName ||
            status.name ||
            status.text ||
            status.value ||
            ""
        ) || "NS";
    }

    if (status) return text(status);

    return text(
        game.gameTime ||
        game.clock ||
        game.phase ||
        "NS"
    );
}

function competition(game) {
    return (
        game.competition ||
        game.tournament ||
        game.league ||
        game.competitionObj ||
        {}
    );
}

function competitionId(game) {
    return text(
        game.competitionId ||
        game.tournamentId ||
        game.leagueId ||
        objectId(competition(game))
    );
}

function competitionName(game) {
    return (
        objectName(competition(game)) ||
        text(
            game.competitionName ||
            game.tournamentName ||
            game.leagueName ||
            ""
        )
    );
}

function sportId(game) {
    return text(
        game.sportId ||
        game.sportTypeId ||
        objectId(
            game.sport ||
            game.sportObj ||
            game.sportType ||
            {}
        )
    );
}

function sportName(game) {
    return (
        objectName(
            game.sport ||
            game.sportObj ||
            game.sportType ||
            {}
        ) ||
        text(game.sportName || "")
    );
}

function extractGames(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];

    const arrays = [
        data.games,
        data.events,
        data.fixtures,
        data.results,
        data.data,
        data.games && data.games.items,
        data.data && data.data.games,
        data.data && data.data.events
    ];

    for (let i = 0; i < arrays.length; i++) {
        if (Array.isArray(arrays[i])) return arrays[i];
    }

    return [];
}

async function apiGet(date) {
    const response = await axios.get(API_URL, {
        timeout: REQUEST_TIMEOUT,
        headers: API_HEADERS,
        params: {
            startDate: date,
            endDate: date,
            lang: "en",
            timezoneName: TIME_ZONE
        }
    });

    if (!response || response.status < 200 ||
        response.status >= 300) {
        throw new Error("365Scores API request failed.");
    }

    return response.data;
}

function getParserSettings(settings) {
    const parserName = text(settings.selected_parser) || "parse1";
    const parser = settings.parse && settings.parse[parserName];

    return {
        parserName: parserName,
        parser: parser || {}
    };
}

function is365Parser(settings) {
    const config = getParserSettings(settings);
    const name = text(config.parser.api_parser).toLowerCase();

    return name === "365" ||
        name === "365scores" ||
        name === "365-scores";
}

async function ensureBaseNodes(db) {
    const ref = db.ref();
    const snapshot = await ref.once("value");
    const root = snapshot.val() || {};
    const updates = {};

    if (!root.settings || typeof root.settings !== "object") {
        updates.settings = {
            selected_parser: "parse1",
            selected_sport: 1,
            selected_sports: [null, true],
            parse: {
                parse1: {
                    api_parser: "365",
                    api_url: API_URL,
                    game_api_url:
                        "https://webws.365scores.com/web/game/?gameId={gameId}"
                }
            }
        };
    } else {
        const settings = root.settings;
        const parserName = text(settings.selected_parser) || "parse1";

        if (!settings.selected_parser) {
            updates["settings/selected_parser"] = "parse1";
        }

        if (!settings.parse || typeof settings.parse !== "object") {
            updates["settings/parse"] = {
                [parserName]: {
                    api_parser: "365",
                    api_url: API_URL,
                    game_api_url:
                        "https://webws.365scores.com/web/game/?gameId={gameId}"
                }
            };
        } else {
            const parser = settings.parse[parserName];

            if (!parser || typeof parser !== "object") {
                updates["settings/parse/" + parserName] = {
                    api_parser: "365",
                    api_url: API_URL,
                    game_api_url:
                        "https://webws.365scores.com/web/game/?gameId={gameId}"
                };
            } else {
                if (!parser.api_parser) {
                    updates["settings/parse/" + parserName + "/api_parser"] = "365";
                }

                if (!parser.api_url) {
                    updates["settings/parse/" + parserName + "/api_url"] = API_URL;
                }

                if (!parser.game_api_url) {
                    updates["settings/parse/" + parserName + "/game_api_url"] =
                        "https://webws.365scores.com/web/game/?gameId={gameId}";
                }
            }
        }
    }

    if (!root.sports || typeof root.sports !== "object") {
        updates.sports = DEFAULT_SPORTS;
    } else {
        Object.keys(DEFAULT_SPORTS).forEach(function (key) {
            if (!root.sports[key]) {
                updates["sports/" + key] = DEFAULT_SPORTS[key];
            }
        });
    }

    if (!root.competitions || typeof root.competitions !== "object") {
        updates.competitions = {};
    }

    if (!root.competition_selection ||
        typeof root.competition_selection !== "object") {
        updates.competition_selection = {};
    }

    if (!root.matches || typeof root.matches !== "object") {
        updates.matches = {};
    }

    if (!root.syncSettings || typeof root.syncSettings !== "object") {
        updates.syncSettings = {
            autoSyncEnabled: true,
            syncIntervalMinutes: 5,
            lastSuccessfulSync: 0
        };
    }

    if (Object.keys(updates).length > 0) {
        await ref.update(updates);
        console.log("Created missing Firebase nodes.");
    }

    const settingsSnapshot = await db.ref("settings").once("value");
    return settingsSnapshot.val() || {};
}

function convertGame(game, old) {
    const pair = teams(game);
    const home = objectName(pair.home);
    const away = objectName(pair.away);
    const id = fixtureId(game);
    const compId = competitionId(game);
    const compName = competitionName(game);
    const sId = sportId(game);
    const date = kickoff(game);

    if (!id || !home || !away || !compId) return null;

    const homeScore = scoreFor(game, "home");
    const awayScore = scoreFor(game, "away");

    let score = "-";

    if (homeScore !== "" || awayScore !== "") {
        score =
            (homeScore === "" ? "0" : homeScore) +
            " - " +
            (awayScore === "" ? "0" : awayScore);
    }

    const status = gameStatus(game);
    const existing = old || {};

    let time = "";

    if (date) {
        time = new Intl.DateTimeFormat("en-GB", {
            timeZone: TIME_ZONE,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).format(date);
    }

    const match = Object.assign({}, existing, {
        gameId: id,
        apiFixtureId: id,
        apiProvider: PROVIDER,
        competitionId: compId,
        sportId: sId,
        home: home,
        away: away,
        homeCompetitorId:
            objectId(pair.home) || existing.homeCompetitorId || "",
        awayCompetitorId:
            objectId(pair.away) || existing.awayCompetitorId || "",
        homeLogo: teamLogo(pair.home) || existing.homeLogo || "",
        awayLogo: teamLogo(pair.away) || existing.awayLogo || "",
        league: compName || existing.league || "Unknown Competition",
        date: date ? displayDate(date) : (existing.date || ""),
        time: time || existing.time || "",
        score: score !== "-" ? score : (existing.score || "-"),
        status: status || existing.status || "NS",
        shortStatus: status || existing.shortStatus || "NS",
        timestamp: date
            ? date.getTime()
            : (existing.timestamp || timestamp()),
        matchTimeMillis: date
            ? date.getTime()
            : (existing.matchTimeMillis || 0)
    });

    return {
        id: id,
        competitionId: compId,
        competitionName: compName,
        sportId: sId,
        sportName: sportName(game),
        match: match
    };
}

function getDatabase() {
    if (!FIREBASE_SERVICE_ACCOUNT) {
        throw new Error("Missing FIREBASE_SERVICE_ACCOUNT secret.");
    }

    if (!FIREBASE_DATABASE_URL) {
        throw new Error("Missing FIREBASE_DATABASE_URL secret.");
    }

    if (!admin.apps.length) {
        let serviceAccount;

        try {
            serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
        } catch (e) {
            throw new Error("FIREBASE_SERVICE_ACCOUNT is invalid JSON.");
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: FIREBASE_DATABASE_URL
        });
    }

    return admin.database();
}

async function ensureSports(db, records) {
    const snapshot = await db.ref("sports").once("value");
    const sports = snapshot.val() || {};
    const updates = {};

    records.forEach(function (record) {
        const id = text(record.sportId);
        const name = text(record.sportName);

        if (!id || !name) return;

        const key = id.length === 1 ? "0" + id : id;

        if (!sports[key]) {
            const defaults = DEFAULT_SPORTS[key] || {};

            updates["sports/" + key] = Object.assign(
                {},
                defaults,
                {
                    id: Number(id),
                    name: name
                }
            );
        }
    });

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
    }
}

async function ensureCompetitions(db, records) {
    const compRef = db.ref("competitions");
    const selectionRef = db.ref("competition_selection");

    const compSnap = await compRef.once("value");
    const selectionSnap = await selectionRef.once("value");

    const oldCompetitions = compSnap.val() || {};
    const oldSelections = selectionSnap.val() || {};
    const updates = {};

    records.forEach(function (record) {
        const id = cleanKey(record.competitionId);

        if (!id) return;

        const old = oldCompetitions[id] || {};
        const hasSelection = Object.prototype.hasOwnProperty.call(
            oldSelections,
            id
        );

        const selected = hasSelection
            ? normalizeBoolean(oldSelections[id])
            : normalizeBoolean(old.selected);

        const comp = Object.assign({}, old, {
            id: record.competitionId,
            name: record.competitionName ||
                old.name ||
                "Unknown Competition",
            selected: selected,
            sportId: record.sportId || old.sportId || ""
        });

        updates["competitions/" + id] = comp;

        if (!hasSelection) {
            updates["competition_selection/" + id] = selected;
        }
    });

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
    }

    const newCompSnap = await compRef.once("value");
    const newSelectionSnap = await selectionRef.once("value");

    return {
        competitions: newCompSnap.val() || {},
        selections: newSelectionSnap.val() || {}
    };
}

async function main() {
    console.log("====================================");
    console.log("Sports Hub 365Scores Sync");
    console.log("====================================");

    const db = getDatabase();
    const settings = await ensureBaseNodes(db);

    if (!is365Parser(settings)) {
        console.log(
            "Warning: selected parser is not 365Scores. Continuing with 365Scores."
        );
    }

    const dates = getDates();

    console.log("Dates:", dates.join(", "));

    const allGames = [];
    const seen = {};

    for (let i = 0; i < dates.length; i++) {
        console.log("Fetching:", dates[i]);

        const data = await apiGet(dates[i]);
        const games = extractGames(data);

        console.log("Games returned:", games.length);

        games.forEach(function (game) {
            const id = fixtureId(game);

            if (!id || seen[id]) return;

            seen[id] = true;
            allGames.push(game);
        });

        await sleep(REQUEST_DELAY);
    }

    if (allGames.length === 0) {
        console.log("No games returned. Existing matches unchanged.");
        return;
    }

    const records = [];

    allGames.forEach(function (game) {
        const record = convertGame(game, null);

        if (record) records.push(record);
    });

    if (records.length === 0) {
        console.log("No valid records. Existing matches unchanged.");
        return;
    }

    await ensureSports(db, records);

    const result = await ensureCompetitions(db, records);
    const selections = result.selections || {};

    const selectedCompetitionIds = Object.keys(selections).filter(
        function (id) {
            return normalizeBoolean(selections[id]);
        }
    );

    const apiCompetitionIds = Array.from(
        new Set(
            records.map(function (record) {
                return cleanKey(record.competitionId);
            })
        )
    );

    console.log("Selected competition IDs:", selectedCompetitionIds);
    console.log("Competition IDs in API:", apiCompetitionIds);

    const selectedIdSet = {};

    selectedCompetitionIds.forEach(function (id) {
        selectedIdSet[cleanKey(id)] = true;
    });

    const selectedRecords = records.filter(function (record) {
        const id = cleanKey(record.competitionId);
        return selectedIdSet[id] === true;
    });

    console.log("Games fetched:", allGames.length);
    console.log("Valid games:", records.length);
    console.log("Selected-competition games:", selectedRecords.length);

    if (selectedRecords.length === 0) {
        console.log(
            "No selected competitions found. Existing matches unchanged."
        );
        return;
    }

    const matchesRef = db.ref("matches");
    const matchesSnapshot = await matchesRef.once("value");
    const existingMatches = matchesSnapshot.val() || {};
    const updates = {};

    let savedCount = 0;

    selectedRecords.forEach(function (record) {
        const id = cleanKey(record.id);

        if (!id) return;

        const old = existingMatches[id] || {};

        const sourceGame = allGames.find(function (game) {
            return fixtureId(game) === record.id;
        });

        if (!sourceGame) return;

        const converted = convertGame(sourceGame, old);

        if (!converted) return;

        updates["matches/" + id] = converted.match;
        savedCount++;
    });

    if (savedCount === 0) {
        console.log("No matches prepared for saving.");
        return;
    }

    await db.ref().update(updates);

    const successTime = timestamp();

    await db.ref("syncSettings").update({
        lastSuccessfulSync: successTime,
        lastSyncProvider: PROVIDER,
        lastSyncStatus: "success",
        lastSyncGamesFetched: allGames.length,
        lastSyncValidGames: records.length,
        lastSyncMatchesSaved: savedCount
    });

    console.log("====================================");
    console.log("Sync completed successfully.");
    console.log("Provider:", PROVIDER);
    console.log("Games fetched:", allGames.length);
    console.log("Matches saved:", savedCount);
    console.log("====================================");
}

main().catch(function (error) {
    console.error("Sports Hub sync failed.");
    console.error(
        error && error.stack
            ? error.stack
            : error.message || error
    );

    process.exitCode = 1;
});
