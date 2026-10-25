
"use strict";

const admin = require("firebase-admin");
const path = require("path");

const TIME_ZONE = "Asia/Kolkata";
const FETCH_DATES = [-1, 0, 1];

function fail(message) {
    throw new Error(message);
}

function toId(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
}

function toText(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
}

function toNumber(value) {
    if (value === null || value === undefined || value === "") return 0;
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function dateParts(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const result = {};

    parts.forEach(function (part) {
        result[part.type] = part.value;
    });

    return result;
}

function getDate(offset) {
    const current = dateParts(new Date());

    const date = new Date(Date.UTC(
        Number(current.year),
        Number(current.month) - 1,
        Number(current.day) + offset
    ));

    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    return {
        iso: year + "-" + month + "-" + day,
        display: day + "-" + month + "-" + year
    };
}

function normalizeProvider(value) {
    const provider = toText(value).toLowerCase();

    if (["365", "365scores", "365-scores"].includes(provider)) {
        return "365scores";
    }

    if (["king", "totalsportslive"].includes(provider)) {
        return "king";
    }

    if (
        ["api_parser", "api-football", "apifootball", "football"]
            .includes(provider)
    ) {
        return "api-football";
    }

    return provider;
}

function getProvider(settings) {
    const parserKey = settings.selected_parser || "parse1";
    const parser = settings.parse && settings.parse[parserKey];

    if (!parser) {
        fail("Selected parser not found: " + parserKey);
    }

    const name = normalizeProvider(parser.api_parser);

    if (!["365scores", "king", "api-football"].includes(name)) {
        fail("Unsupported API provider: " + name);
    }

    return {
        name: name,
        parserKey: parserKey,
        parserSettings: parser
    };
}

function getPreviousProvider(settings) {
    const previousUrl = toText(settings.last_api);

    if (!previousUrl || !settings.parse) return "";

    const keys = Object.keys(settings.parse);

    for (let i = 0; i < keys.length; i++) {
        const parser = settings.parse[keys[i]] || {};

        if (toText(parser.api_url) === previousUrl) {
            return normalizeProvider(parser.api_parser);
        }
    }

    return "";
}

/*
 * Supports selected_sports as an array or Firebase object/map.
 */
function getSelectedSports(settings) {
    const value = settings && settings.selected_sports;
    const result = [];

    if (Array.isArray(value)) {
        value.forEach(function (item, index) {
            if (item === true && index > 0) {
                result.push(String(index));
            } else if (item && typeof item === "object") {
                if (
                    item.id !== undefined &&
                    item.selected !== false
                ) {
                    result.push(toId(item.id));
                }
            } else if (
                typeof item === "number" ||
                typeof item === "string"
            ) {
                const id = toId(item);

                if (id && id !== "0") {
                    result.push(id);
                }
            }
        });
    } else if (value && typeof value === "object") {
        Object.keys(value).forEach(function (id) {
            const item = value[id];

            if (item === true) {
                result.push(toId(id));
            } else if (
                item &&
                typeof item === "object" &&
                item.selected !== false
            ) {
                result.push(toId(
                    item.id !== undefined ? item.id : id
                ));
            }
        });
    }

    return Array.from(new Set(result.filter(Boolean)));
}

function loadProvider(providerName) {
    const files = {
        "365scores": "365scores.js",
        "king": "king.js",
        "api-football": "api-football.js"
    };

    const fileName = files[providerName];

    if (!fileName) {
        fail("No module configured for provider: " + providerName);
    }

    return require(path.join(__dirname, "apis", fileName));
}

function getCompetitionId(match) {
    return toId(
        match.competitionId ||
        match.leagueId ||
        match.tournamentId ||
        match.competition_id
    );
}

function getCompetitionName(match) {
    return toText(
        match.competitionName ||
        match.competitionDisplayName ||
        match.league ||
        match.competition ||
        match.leagueName ||
        "Unknown Competition"
    );
}

function getSportId(match) {
    return toNumber(
        match.sportId !== undefined
            ? match.sportId
            : (match.sport_id !== undefined ? match.sport_id : 1)
    );
}

function normalizeDate(value) {
    const text = toText(value);

    if (/^\d{2}-\d{2}-\d{4}$/.test(text)) {
        return text;
    }

    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (iso) {
        return iso[3] + "-" + iso[2] + "-" + iso[1];
    }

    return text;
}

/*
 * Normalize goal events.
 * Supports scorer, minute, goal type and assist details.
 */
function normalizeGoalEvents(value) {
    let events = [];

    if (Array.isArray(value)) {
        events = value;
    } else if (value && typeof value === "object") {
        events = Object.keys(value).map(function (key) {
            return value[key];
        });
    }

    return events.map(function (event) {
        event = event || {};

        return {
            competitorId: toNumber(event.competitorId),
            gameTime: toText(event.gameTime),
            playerId: toNumber(event.playerId),
            playerName: toText(event.playerName),
            type: toText(event.type),
            assistId: toNumber(event.assistId),
            assistName: toText(event.assistName)
        };
    });
}

/*
 * Normalize match data for Firebase.
 * Preserve an existing streamUrl if the API does not provide one.
 */
function normalizeMatch(raw, oldMatch) {
    const match = raw || {};

    const gameId = toId(
        match.gameId ||
        match.apiFixtureId ||
        match.fixtureId ||
        match.id
    );

    if (!gameId) return null;

    const home = toText(
        match.home ||
        match.homeTeam ||
        match.homeName ||
        match.homeTeamName
    );

    const away = toText(
        match.away ||
        match.awayTeam ||
        match.awayName ||
        match.awayTeamName
    );

    const homeScore = match.homeScore !== undefined
        ? match.homeScore
        : (match.goals ? match.goals.home : undefined);

    const awayScore = match.awayScore !== undefined
        ? match.awayScore
        : (match.goals ? match.goals.away : undefined);

    let score = toText(match.score);

    if (
        !score &&
        homeScore !== undefined &&
        homeScore !== null &&
        awayScore !== undefined &&
        awayScore !== null
    ) {
        score = homeScore + " - " + awayScore;
    }

    if (!score) score = "VS";

    const newStreamUrl = toText(match.streamUrl);
    const oldStreamUrl = oldMatch
        ? toText(oldMatch.streamUrl)
        : "";

    return {
        away: away,

        awayCompetitorId: toNumber(
            match.awayCompetitorId ||
            match.awayTeamId ||
            match.awayId
        ),

        awayLogo: toText(
            match.awayLogo || match.awayTeamLogo
        ),

        competitionId: toNumber(getCompetitionId(match)),
        date: normalizeDate(match.date),

        gameId: /^\d+$/.test(gameId) ? Number(gameId) : gameId,

        goalEvents: normalizeGoalEvents(match.goalEvents),

        home: home,

        homeCompetitorId: toNumber(
            match.homeCompetitorId ||
            match.homeTeamId ||
            match.homeId
        ),

        homeLogo: toText(
            match.homeLogo || match.homeTeamLogo
        ),

        league: getCompetitionName(match),

        matchTimeMillis: toNumber(
            match.matchTimeMillis || match.timestamp
        ),

        score: score,

        shortStatus: toText(
            match.shortStatus || match.status || "NS"
        ),

        sportId: getSportId(match),

        stadium: toText(match.stadium || match.venue),

        status: toText(
            match.status || match.shortStatus || "NS"
        ),

        streamUrl: newStreamUrl || oldStreamUrl,

        time: toText(match.time)
    };
}

/*
 * Normalize competition data.
 */
function normalizeCompetition(
    raw,
    oldCompetition,
    selection,
    matchCount
) {
    const id = toId(
        raw.id || raw.competitionId || raw.leagueId
    );

    if (!id) return null;

    let selected = false;

    if (selection[id] === true) {
        selected = true;
    } else if (
        selection[id] === undefined &&
        oldCompetition &&
        oldCompetition.selected === true
    ) {
        selected = true;
    }

    return {
        id: /^\d+$/.test(id) ? Number(id) : id,

        name: toText(
            raw.name ||
            raw.competitionName ||
            raw.competitionDisplayName ||
            raw.league ||
            id
        ),

        selected: selected,

        sportId: toNumber(
            raw.sportId || raw.sport_id || 1
        ),

        matchCount: toNumber(matchCount)
    };
}

/*
 * Normalize provider catalog.
 */
function normalizeCatalog(catalog) {
    const competitions = {};
    const sports = {};

    let source = catalog || {};

    if (source.data && typeof source.data === "object") {
        source = source.data;
    }

    const competitionList = Array.isArray(source.competitions)
        ? source.competitions
        : [];

    competitionList.forEach(function (item) {
        const id = toId(
            item.id ||
            item.competitionId ||
            item.leagueId
        );

        if (id) {
            competitions[id] = item;
        }
    });

    const sportsList = Array.isArray(source.sports)
        ? source.sports
        : [];

    sportsList.forEach(function (item) {
        const id = toId(item.id);

        if (!id || !item.name) return;

        sports[id] = item;
    });

    return {
        competitions: competitions,
        sports: sports
    };
}

/*
 * Build Firebase sports from the API catalog.
 * Preserve fields not supplied by the API.
 */
function buildSportsFromApi(apiSports, oldSports) {
    if (!Array.isArray(apiSports) || apiSports.length === 0) {
        return null;
    }

    const result = {};
    const oldById = {};

    Object.keys(oldSports || {}).forEach(function (key) {
        const item = oldSports[key] || {};
        const id = toId(item.id || key);

        if (id) {
            oldById[id] = item;
        }
    });

    apiSports.forEach(function (sport) {
        if (!sport) return;

        const id = toId(sport.id);
        const name = toText(sport.name);

        if (!id || !name) return;

        const old = oldById[id] || {};
        const key = id.padStart(2, "0");

        result[key] = {
            id: /^\d+$/.test(id) ? Number(id) : id,

            name: name,

            nameForURL: toText(
                sport.nameForURL !== undefined
                    ? sport.nameForURL
                    : old.nameForURL
            ),

            totalGames: sport.totalGames !== undefined
                ? toNumber(sport.totalGames)
                : toNumber(old.totalGames),

            liveGames: sport.liveGames !== undefined
                ? toNumber(sport.liveGames)
                : toNumber(old.liveGames),

            imageVersion: sport.imageVersion !== undefined
                ? sport.imageVersion
                : (
                    old.imageVersion !== undefined
                        ? old.imageVersion
                        : 1
                ),

            drawSupport: old.drawSupport === true
        };
    });

    return Object.keys(result).length > 0 ? result : null;
}

/*
 * Fetch matches for yesterday, today and tomorrow.
 */
async function fetchMatches(
    provider,
    providerName,
    parserSettings,
    sports,
    settings
) {
    const allMatches = {};
    const errors = [];

    for (const offset of FETCH_DATES) {
        const date = getDate(offset);

        try {
            let result;

            if (providerName === "api-football") {
                result = await provider.fetchMatches({
                    date: date.iso,

                    // Pass Firebase settings so the provider can
                    // use settings.apiFootballKey if configured.
                    settings: settings,

                    parserSettings: parserSettings,
                    sportIds: sports,
                    timeZone: TIME_ZONE
                });
            } else if (providerName === "king") {
                result = await provider.fetchMatches({
                    date: date.iso,
                    startDate: date.display,
                    endDate: date.display,
                    parserSettings: parserSettings,
                    sportIds: sports,
                    timeZone: TIME_ZONE
                });
            } else {
                result = await provider.fetchMatches({
                    sportIds: sports,
                    startDate: date.display.replace(/-/g, "/"),
                    endDate: date.display.replace(/-/g, "/"),
                    parserSettings: parserSettings,
                    timeZone: TIME_ZONE
                });
            }

            if (!Array.isArray(result)) {
                fail(
                    providerName +
                    " fetchMatches() must return an array."
                );
            }

            result.forEach(function (raw) {
                const match = normalizeMatch(raw, null);

                if (match) {
                    allMatches[toId(match.gameId)] = raw;
                }
            });

            console.log(
                providerName + " fetched " + result.length +
                " matches for " + date.iso
            );
        } catch (error) {
            errors.push(date.iso + ": " + error.message);

            console.error(
                providerName + " failed for " + date.iso + ":",
                error.message
            );
        }
    }

    if (errors.length > 0) {
        fail(
            "One or more date requests failed. " +
            "Existing Firebase data was not updated. " +
            errors.join(" | ")
        );
    }

    if (Object.keys(allMatches).length === 0) {
        fail(
            "No matches fetched. Existing Firebase data was not updated."
        );
    }

    return Object.values(allMatches);
}

function buildCompetitionCounts(fetchedMatches) {
    const counts = {};

    fetchedMatches.forEach(function (match) {
        const id = getCompetitionId(match);

        if (!id) return;

        counts[id] = (counts[id] || 0) + 1;
    });

    return counts;
}

function logCompetitionMatchCounts(fetchedMatches, newSelection) {
    const matchCountByCompetition = {};

    fetchedMatches.forEach(function (match) {
        const id = getCompetitionId(match);

        if (!id) return;

        const name = getCompetitionName(match);
        const key = String(id);

        if (!matchCountByCompetition[key]) {
            matchCountByCompetition[key] = {
                name: name,
                total: 0,
                selected: newSelection[key] === true
            };
        }

        matchCountByCompetition[key].total++;
    });

    console.log("");
    console.log("========== MATCH COUNT BY COMPETITION ==========");

    const ids = Object.keys(matchCountByCompetition).sort(
        function (a, b) {
            return (
                matchCountByCompetition[b].total -
                matchCountByCompetition[a].total
            );
        }
    );

    ids.forEach(function (id) {
        const item = matchCountByCompetition[id];

        console.log(
            item.name +
            " | ID: " + id +
            " | Matches: " + item.total +
            " | Selected: " + (item.selected ? "YES" : "NO")
        );
    });

    console.log("Competitions with fetched matches:", ids.length);

    console.log(
        "Total counted matches:",
        ids.reduce(function (sum, id) {
            return sum + matchCountByCompetition[id].total;
        }, 0)
    );

    console.log("================================================");
    console.log("");
}

async function main() {
    const serviceAccountText = process.env.FIREBASE_SERVICE_ACCOUNT;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountText || !databaseURL) {
        fail("Firebase secrets are missing.");
    }

    let serviceAccount;

    try {
        serviceAccount = JSON.parse(serviceAccountText);
    } catch (error) {
        fail("FIREBASE_SERVICE_ACCOUNT is not valid JSON.");
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: databaseURL
    });

    const db = admin.database();
    const rootRef = db.ref("/");
    const snapshot = await rootRef.once("value");
    const root = snapshot.val() || {};

    const settings = root.settings || {};
    const selection = root.competition_selection || {};
    const oldMatches = root.matches || {};
    const oldCompetitions = root.competitions || {};
    const oldSports = root.sports || {};

    const selected = getProvider(settings);
    const providerName = selected.name;
    const parserSettings = selected.parserSettings;
    const provider = loadProvider(providerName);
    const previousProvider = getPreviousProvider(settings);

    const providerChanged =
        previousProvider !== "" &&
        previousProvider !== providerName;

    const selectedSports = getSelectedSports(settings);

    console.log("Selected parser:", selected.parserKey);
    console.log("Selected provider:", providerName);
    console.log("Previous provider:", previousProvider || "not recorded");
    console.log("Provider changed:", providerChanged);
    console.log("Selected sports:", JSON.stringify(selectedSports));

    /*
     * Do not start a 365Scores sync if no sports are selected.
     */
    if (providerName === "365scores" && selectedSports.length === 0) {
        fail(
            "No sports selected for 365Scores. " +
            "Check settings/selected_sports in Firebase."
        );
    }

    let catalog = {
        competitions: {},
        sports: {}
    };

    if (typeof provider.fetchCatalog === "function") {
        try {
            const rawCatalog = await provider.fetchCatalog({
                sportIds: selectedSports,
                settings: settings,
                parserSettings: parserSettings,
                timeZone: TIME_ZONE
            });

            catalog = normalizeCatalog(rawCatalog);

            console.log(
                "Catalog sports received:",
                Object.keys(catalog.sports).length
            );

            console.log(
                "Catalog competitions received:",
                Object.keys(catalog.competitions).length
            );
        } catch (error) {
            console.warn("Catalog fetch failed:", error.message);
        }
    } else {
        console.warn(
            "Provider does not implement fetchCatalog(); " +
            "existing sports data will be preserved."
        );
    }

    const fetchedMatches = await fetchMatches(
        provider,
        providerName,
        parserSettings,
        selectedSports,
        settings
    );

    if (fetchedMatches.length === 0) {
        fail(
            "No matches returned. Existing Firebase data was not replaced."
        );
    }

    const builtSports = buildSportsFromApi(
        Object.values(catalog.sports || {}),
        oldSports
    );

    const newSports = builtSports || oldSports;

    console.log(
        builtSports
            ? "Sports node will be updated from API catalog."
            : "Sports node will be preserved; API sports catalog unavailable."
    );

    const competitionCounts = buildCompetitionCounts(fetchedMatches);
    const competitionRaw = Object.assign({}, catalog.competitions);

    fetchedMatches.forEach(function (raw) {
        const id = getCompetitionId(raw);

        if (id && !competitionRaw[id]) {
            competitionRaw[id] = {
                id: id,
                name: getCompetitionName(raw),
                sportId: getSportId(raw)
            };
        }
    });

    const newCompetitions = {};
    const newSelection = {};

    Object.keys(competitionRaw).forEach(function (id) {
        const competition = normalizeCompetition(
            competitionRaw[id],
            providerChanged ? null : oldCompetitions[id],
            providerChanged ? {} : selection,
            competitionCounts[id] || 0
        );

        if (!competition) return;

        newCompetitions[id] = competition;
        newSelection[id] = competition.selected;
    });

    if (Object.keys(newCompetitions).length === 0) {
        fail(
            "No competitions discovered. Existing data was not replaced."
        );
    }

    logCompetitionMatchCounts(fetchedMatches, newSelection);

    const finalMatches = {};

    if (!providerChanged) {
        Object.keys(oldMatches).forEach(function (id) {
            const cleaned = normalizeMatch(oldMatches[id], null);

            if (cleaned) {
                finalMatches[toId(cleaned.gameId || id)] = cleaned;
            }
        });
    }

    let selectedMatchCount = 0;

    fetchedMatches.forEach(function (raw) {
        const id = toId(
            raw.gameId ||
            raw.apiFixtureId ||
            raw.fixtureId ||
            raw.id
        );

        if (!id) return;

        const competitionId = getCompetitionId(raw);

        if (!competitionId) return;

        const isSelected = newSelection[competitionId] === true;

        if (!isSelected) return;

        if (
            selectedSports.length > 0 &&
            !selectedSports.includes(String(getSportId(raw)))
        ) {
            return;
        }

        const oldMatch = providerChanged ? null : oldMatches[id];
        const cleaned = normalizeMatch(raw, oldMatch);

        if (cleaned) {
            finalMatches[id] = cleaned;
            selectedMatchCount++;
        }
    });

    const updates = {
        sports: newSports,
        competitions: newCompetitions,
        competition_selection: newSelection,
        matches: finalMatches,

        "settings/last_api": toText(
            parserSettings.api_url || settings.last_api
        )
    };

    await rootRef.update(updates);

    console.log("");
    console.log("========== SYNC SUMMARY ==========");
    console.log("Provider:", providerName);
    console.log("Selected sports:", JSON.stringify(selectedSports));
    console.log("Competitions:", Object.keys(newCompetitions).length);
    console.log("Matches fetched:", fetchedMatches.length);
    console.log("Selected matches:", selectedMatchCount);
    console.log("Total matches stored:", Object.keys(finalMatches).length);
    console.log("Competition matchCount saved:", true);
    console.log("Sports updated from API:", Boolean(builtSports));
    console.log("Sports stored:", Object.keys(newSports).length);
    console.log("Sports Hub sync completed.");
    console.log("==================================");
}

main()
    .catch(function (error) {
        console.error("Sports Hub sync failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async function () {
        if (admin.apps.length > 0) {
            await Promise.all(
                admin.apps.map(function (app) {
                    return app.delete();
                })
            );
        }
    });
