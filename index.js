
"use strict";

const admin = require("firebase-admin");
const path = require("path");

const TIME_ZONE = "Asia/Kolkata";
const FETCH_DATES = [-1, 0, 1];

if (!admin.apps.length) {
    const serviceAccountJson =
        process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!serviceAccountJson) {
        throw new Error(
            "Missing FIREBASE_SERVICE_ACCOUNT secret."
        );
    }

    const databaseURL =
        process.env.FIREBASE_DATABASE_URL;

    if (!databaseURL) {
        throw new Error(
            "Missing FIREBASE_DATABASE_URL secret."
        );
    }

    admin.initializeApp({
        credential: admin.credential.cert(
            JSON.parse(serviceAccountJson)
        ),
        databaseURL: databaseURL
    });
}

const db = admin.database();
const rootRef = db.ref("/");

function number(value) {
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
}

function normalizeId(value) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value).trim();
}

function dateString(offset) {
    const now = new Date();

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(now);

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    const date = new Date(Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        12,
        0,
        0
    ));

    date.setUTCDate(date.getUTCDate() + offset);

    const output = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const result = {};

    output.forEach(function (part) {
        result[part.type] = part.value;
    });

    return result.day + "/" +
        result.month + "/" +
        result.year;
}

function normalizeProviderName(value) {
    const provider = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/_/g, "-");

    if (
        provider === "365" ||
        provider === "365scores" ||
        provider === "365-scores"
    ) {
        return "365scores";
    }

    if (
        provider === "api-football" ||
        provider === "apifootball"
    ) {
        return "api-football";
    }

    return provider;
}

function getSelectedParser(settings) {
    const parserName = String(
        settings.selected_parser || ""
    );

    const parserConfig =
        settings.parse &&
        settings.parse[parserName]
            ? settings.parse[parserName]
            : {};

    const provider = normalizeProviderName(
        parserConfig.api_parser ||
        settings.api_parser ||
        settings.provider ||
        "365scores"
    );

    return {
        parserName: parserName,
        provider: provider,
        config: parserConfig
    };
}

function getSelectedSports(settings, parser) {
    const config = parser.config || {};

    let value =
        config.selectedSports ||
        config.selected_sports ||
        config.sportIds ||
        config.sport_ids ||
        settings.selectedSports ||
        settings.selected_sports ||
        settings.sportIds ||
        settings.sport_ids ||
        [];

    if (!Array.isArray(value)) {
        if (typeof value === "string") {
            value = value.split(",");
        } else {
            value = [];
        }
    }

    return value.map(function (item) {
        if (item && typeof item === "object") {
            return number(
                item.id ||
                item.sportId ||
                item.sport_id
            );
        }

        return number(item);
    }).filter(function (id, index, list) {
        return id > 0 && list.indexOf(id) === index;
    });
}

function loadProvider(providerName) {
    const files = {
        "365scores": "365scores.js",
        "api-football": "api-football.js"
    };

    const fileName = files[providerName];

    if (!fileName) {
        throw new Error(
            "Unsupported provider: " + providerName +
            ". Add its module under the apis folder."
        );
    }

    const modulePath = path.join(
        __dirname,
        "apis",
        fileName
    );

    const provider = require(modulePath);

    if (typeof provider.fetchMatches !== "function") {
        throw new Error(
            providerName +
            " module must export fetchMatches(options)."
        );
    }

    return provider;
}

function getMatchId(match) {
    return normalizeId(
        match.gameId ||
        match.apiFixtureId ||
        match.fixtureId ||
        match.fixture_id ||
        match.id
    );
}

function getCompetitionId(match) {
    return normalizeId(
        match.competitionId ||
        match.competition_id ||
        match.leagueId ||
        match.league_id ||
        (match.competition && match.competition.id) ||
        (match.league && match.league.id)
    );
}

function getCompetitionName(match) {
    return String(
        match.competitionName ||
        match.competitionDisplayName ||
        match.leagueName ||
        match.league_name ||
        (match.competition && match.competition.name) ||
        (match.league && match.league.name) ||
        match.league ||
        ""
    );
}

function normalizeCompetition(item, providerName) {
    const id = normalizeId(
        item.id || item.competitionId || item.leagueId
    );

    return {
        id: number(id),
        competitionId: number(id),
        sportId: number(
            item.sportId ||
            item.sport_id ||
            item.sport
        ),
        countryId: number(
            item.countryId || item.country_id
        ),
        name: String(
            item.name ||
            item.competitionDisplayName ||
            item.leagueName ||
            ""
        ),
        nameForURL: String(item.nameForURL || ""),
        hideOnCatalog: item.hideOnCatalog === true,
        hideOnSearch: item.hideOnSearch === true,
        isInternational: item.isInternational === true,
        totalGames: number(item.totalGames),
        liveGames: number(item.liveGames),
        provider: providerName
    };
}

function buildCatalog(catalog, matches, selectedSports, providerName) {
    const result = {};
    const allowedSports = {};

    selectedSports.forEach(function (id) {
        allowedSports[String(id)] = true;
    });

    function addCompetition(item) {
        const id = normalizeId(
            item.id ||
            item.competitionId ||
            item.leagueId
        );

        if (!id) {
            return;
        }

        const sportId = number(
            item.sportId ||
            item.sport_id ||
            item.sport
        );

        if (
            selectedSports.length &&
            !allowedSports[String(sportId)]
        ) {
            return;
        }

        if (item.hideOnCatalog === true) {
            return;
        }

        const competition = normalizeCompetition(
            Object.assign({}, item, {
                id: id,
                sportId: sportId,
                name:
                    item.name ||
                    item.competitionDisplayName ||
                    item.leagueName ||
                    ""
            }),
            providerName
        );

        result[id] = competition;
    }

    (catalog.competitions || []).forEach(addCompetition);

    /*
     * If the provider catalog does not include competitions,
     * discover them from the fetched games.
     */
    (matches || []).forEach(function (match) {
        const id = getCompetitionId(match);

        if (!id || result[id]) {
            return;
        }

        addCompetition({
            id: id,
            sportId:
                match.sportId ||
                match.sport_id ||
                match.sport,
            name: getCompetitionName(match),
            countryId:
                match.countryId ||
                match.country_id
        });
    });

    return result;
}

function buildSelection(catalog, oldSelection, providerChanged) {
    const selection = {};

    Object.keys(catalog).forEach(function (id) {
        if (
            !providerChanged &&
            oldSelection &&
            oldSelection[id] === true
        ) {
            selection[id] = true;
        } else {
            selection[id] = false;
        }
    });

    return selection;
}

function filterMatches(matches, selection, selectedSports, providerName) {
    const allowedSports = {};
    const result = {};
    const seen = {};

    selectedSports.forEach(function (id) {
        allowedSports[String(id)] = true;
    });

    matches.forEach(function (match) {
        const id = getMatchId(match);
        const competitionId = getCompetitionId(match);

        if (!id || !competitionId || seen[id]) {
            return;
        }

        const sportId = number(
            match.sportId ||
            match.sport_id ||
            match.sport
        );

        if (
            selectedSports.length &&
            !allowedSports[String(sportId)]
        ) {
            return;
        }

        if (selection[competitionId] !== true) {
            return;
        }

        seen[id] = true;

        result[id] = Object.assign({}, match, {
            gameId: id,
            apiFixtureId: id,
            competitionId: number(competitionId),
            sportId: sportId,
            apiProvider: providerName
        });
    });

    return result;
}

function mergeCatalog(oldCatalog, newCatalog) {
    const merged = Object.assign({}, oldCatalog || {});

    Object.keys(newCatalog).forEach(function (id) {
        merged[id] = Object.assign(
            {},
            merged[id] || {},
            newCatalog[id]
        );
    });

    return merged;
}

function validateCatalog(catalog) {
    if (!catalog || typeof catalog !== "object") {
        throw new Error("Provider returned invalid catalog data.");
    }

    if (!Array.isArray(catalog.competitions)) {
        throw new Error(
            "Provider catalog must contain competitions array."
        );
    }
}

async function main() {
    const snapshot = await rootRef.once("value");
    const root = snapshot.val() || {};
    const settings = root.settings || {};

    const parser = getSelectedParser(settings);
    const provider = loadProvider(parser.provider);

    const selectedSports = getSelectedSports(
        settings,
        parser
    );

    if (!selectedSports.length) {
        throw new Error(
            "No sports selected. Select sports in Admin before running sync."
        );
    }

    const oldProvider = normalizeProviderName(
        settings.last_synced_api_provider || ""
    );

    const providerChanged =
        oldProvider !== "" &&
        oldProvider !== parser.provider;

    console.log("Provider:", parser.provider);
    console.log("Selected parser:", parser.parserName);
    console.log("Selected sports:", selectedSports);
    console.log("Provider changed:", providerChanged);

    /*
     * 1. Fetch catalog.
     */
    let catalog = {
        sports: [],
        countries: [],
        competitions: []
    };

    if (typeof provider.fetchCatalog === "function") {
        catalog = await provider.fetchCatalog({
            sportIds: selectedSports,
            timeZone: TIME_ZONE
        });

        validateCatalog(catalog);
    } else {
        console.log(
            "Provider has no fetchCatalog(); deriving competitions from matches."
        );
    }

    console.log(
        "Catalog sports:",
        (catalog.sports || []).length
    );

    console.log(
        "Catalog competitions:",
        (catalog.competitions || []).length
    );

    /*
     * 2. Fetch matches for yesterday, today and tomorrow.
     */
    const allMatches = [];
    const seenMatches = {};

    for (let i = 0; i < FETCH_DATES.length; i++) {
        const date = dateString(FETCH_DATES[i]);

        const matches = await provider.fetchMatches({
            sportIds: selectedSports,
            startDate: date,
            endDate: date,
            timeZone: TIME_ZONE
        });

        if (!Array.isArray(matches)) {
            throw new Error(
                "Provider fetchMatches() must return an array."
            );
        }

        console.log(
            "Date:",
            date,
            "matches:",
            matches.length
        );

        matches.forEach(function (match) {
            const id = getMatchId(match);

            if (!id || seenMatches[id]) {
                return;
            }

            seenMatches[id] = true;
            allMatches.push(match);
        });
    }

    console.log(
        "Unique fetched matches:",
        allMatches.length
    );

    /*
     * 3. Build new catalog from provider catalog + matches.
     */
    const newCatalog = buildCatalog(
        catalog,
        allMatches,
        selectedSports,
        parser.provider
    );

    const oldSelection = root.competition_selection || {};
    const oldCompetitions = root.competitions || {};

    /*
     * Never erase existing data if a provider switch produces
     * an empty catalog and no games.
     */
    if (
        providerChanged &&
        Object.keys(newCatalog).length === 0 &&
        allMatches.length === 0
    ) {
        throw new Error(
            "Provider changed, but no catalog or matches were returned. Existing Firebase data was preserved."
        );
    }

    const selection = buildSelection(
        newCatalog,
        oldSelection,
        providerChanged
    );

    /*
     * 4. Provider changed: save new catalog and reset selection.
     * Clear old-provider matches only after receiving valid new data.
     */
    if (providerChanged) {
        await rootRef.update({
            competitions: newCatalog,
            competition_selection: selection,
            matches: {},
            "settings/last_synced_api_provider": parser.provider,
            "settings/last_sync_status": "success",
            "settings/last_sync_error": null,
            "settings/last_sync_time": Date.now()
        });

        console.log(
            "Provider changed. Catalog saved and selections reset."
        );
        console.log(
            "Select competitions in Admin, then run sync again."
        );
        return;
    }

    /*
     * 5. Filter matches by selected competitions.
     */
    const selectedMatches = filterMatches(
        allMatches,
        selection,
        selectedSports,
        parser.provider
    );

    const updates = {};

    updates.competitions = mergeCatalog(
        oldCompetitions,
        newCatalog
    );

    updates.competition_selection = Object.assign(
        {},
        oldSelection,
        selection
    );

    updates["settings/last_synced_api_provider"] =
        parser.provider;

    updates["settings/last_sync_status"] = "success";
    updates["settings/last_sync_error"] = null;
    updates["settings/last_sync_time"] = Date.now();

    /*
     * Do not overwrite matches if no selected competition
     * yielded matches. Keep the existing records.
     */
    if (Object.keys(selectedMatches).length === 0) {
        await rootRef.update(updates);

        console.log(
            "Catalog updated. No selected-competition matches found."
        );
        console.log(
            "Existing matches preserved."
        );
        return;
    }

    /*
     * Replace the match collection only when selected matches
     * have actually been found.
     */
    updates.matches = selectedMatches;

    await rootRef.update(updates);

    console.log(
        "Sync complete. Catalog competitions:",
        Object.keys(newCatalog).length
    );

    console.log(
        "Saved selected matches:",
        Object.keys(selectedMatches).length
    );
}

main().catch(async function (error) {
    console.error("SportsHub sync failed:", error);

    try {
        await db.ref("settings").update({
            last_sync_status: "failed",
            last_sync_error: String(
                error.message || error
            ),
            last_sync_time: Date.now()
        });
    } catch (saveError) {
        console.error(
            "Could not save error status:",
            saveError.message
        );
    }

    process.exitCode = 1;
});
