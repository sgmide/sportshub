
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

    admin.initializeApp({
        credential: admin.credential.cert(
            JSON.parse(serviceAccountJson)
        ),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}

const db = admin.database();
const rootRef = db.ref("/");

function number(value) {
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
}

function dateString(offset) {
    const date = new Date();

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    /*
     * Build a date around UTC midday to avoid timezone
     * boundary problems when moving between calendar days.
     */
    const base = new Date(
        Date.UTC(
            Number(values.year),
            Number(values.month) - 1,
            Number(values.day),
            12,
            0,
            0
        )
    );

    base.setUTCDate(base.getUTCDate() + offset);

    const resultParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(base);

    const result = {};

    resultParts.forEach(function (part) {
        result[part.type] = part.value;
    });

    return result.day + "/" +
        result.month + "/" +
        result.year;
}

function normalizeProviderName(value) {
    const provider = String(value || "")
        .trim()
        .toLowerCase();

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
        config.sportIds ||
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

    return value
        .map(function (item) {
            if (typeof item === "object" && item !== null) {
                return number(item.id || item.sportId);
            }

            return number(item);
        })
        .filter(function (id) {
            return id > 0;
        })
        .filter(function (id, index, list) {
            return list.indexOf(id) === index;
        });
}

function normalizeId(value) {
    if (value == null) {
        return "";
    }

    return String(value).trim();
}

function getMatchId(match) {
    return normalizeId(
        match.gameId ||
        match.apiFixtureId ||
        match.fixtureId ||
        match.id
    );
}

function getCompetitionId(match) {
    return normalizeId(
        match.competitionId ||
        match.competition_id ||
        (
            match.competition &&
            match.competition.id
        )
    );
}

function getCompetitionName(match) {
    return String(
        match.competitionName ||
        match.competitionDisplayName ||
        (
            match.competition &&
            match.competition.name
        ) ||
        match.league ||
        ""
    );
}

function loadProvider(providerName) {
    if (providerName !== "365scores") {
        throw new Error(
            "Unsupported provider in this version: " +
            providerName
        );
    }

    return require(
        path.join(__dirname, "apis", "365scores.js")
    );
}

function normalizeCompetition(item) {
    return {
        id: number(item.id),
        competitionId: number(item.id),
        sportId: number(item.sportId),
        countryId: number(item.countryId),
        name: String(item.name || ""),
        nameForURL: String(item.nameForURL || ""),
        hideOnCatalog: item.hideOnCatalog === true,
        hideOnSearch: item.hideOnSearch === true,
        isInternational: item.isInternational === true,
        totalGames: number(item.totalGames),
        liveGames: number(item.liveGames),
        provider: "365scores"
    };
}

function buildCatalog(catalog, matches, selectedSports) {
    const result = {};
    const allowedSports = {};

    selectedSports.forEach(function (id) {
        allowedSports[String(id)] = true;
    });

    function addCompetition(item) {
        const id = normalizeId(
            item.id || item.competitionId
        );

        if (!id) {
            return;
        }

        const sportId = number(item.sportId);

        if (
            selectedSports.length &&
            !allowedSports[String(sportId)]
        ) {
            return;
        }

        if (item.hideOnCatalog === true) {
            return;
        }

        const competition = normalizeCompetition({
            id: id,
            sportId: sportId,
            countryId: item.countryId,
            name:
                item.name ||
                item.competitionDisplayName ||
                "",
            nameForURL: item.nameForURL,
            hideOnCatalog: item.hideOnCatalog,
            hideOnSearch: item.hideOnSearch,
            isInternational: item.isInternational,
            totalGames: item.totalGames,
            liveGames: item.liveGames
        });

        result[id] = competition;
    }

    (catalog.competitions || []).forEach(addCompetition);

    /*
     * Add competitions found in games when the catalog
     * endpoint does not provide them.
     */
    (matches || []).forEach(function (match) {
        const id = getCompetitionId(match);

        if (!id || result[id]) {
            return;
        }

        addCompetition({
            id: id,
            sportId: match.sportId,
            name: getCompetitionName(match)
        });
    });

    return result;
}

function buildSelection(catalog, oldSelection, providerChanged) {
    const selection = {};

    Object.keys(catalog).forEach(function (id) {
        if (!providerChanged && oldSelection &&
            oldSelection[id] === true) {
            selection[id] = true;
        } else {
            selection[id] = false;
        }
    });

    return selection;
}

function filterMatches(matches, selection, selectedSports) {
    const allowedSports = {};

    selectedSports.forEach(function (id) {
        allowedSports[String(id)] = true;
    });

    const result = {};
    const seen = {};

    matches.forEach(function (match) {
        const id = getMatchId(match);
        const competitionId = getCompetitionId(match);

        if (!id || !competitionId || seen[id]) {
            return;
        }

        if (
            selectedSports.length &&
            !allowedSports[String(number(match.sportId))]
        ) {
            return;
        }

        if (selection[competitionId] !== true) {
            return;
        }

        seen[id] = true;

        const record = Object.assign({}, match, {
            gameId: id,
            apiFixtureId: id,
            competitionId: number(competitionId),
            apiProvider: "365scores"
        });

        result[id] = record;
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
    console.log("Selected sports:", selectedSports);

    /*
     * 1. Fetch catalog data.
     */
    let catalog = {
        sports: [],
        countries: [],
        competitions: []
    };

    if (typeof provider.fetchCatalog === "function") {
        catalog = await provider.fetchCatalog();
    }

    console.log(
        "Catalog sports:",
        catalog.sports.length
    );

    console.log(
        "Catalog competitions:",
        catalog.competitions.length
    );

    /*
     * 2. Fetch games for yesterday, today and tomorrow.
     */
    const allMatches = [];
    const seenMatches = {};

    for (let i = 0; i < FETCH_DATES.length; i++) {
        const offset = FETCH_DATES[i];
        const date = dateString(offset);

        const matches = await provider.fetchMatches({
            sportIds: selectedSports,
            startDate: date,
            endDate: date
        });

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
     * 3. Build the competition catalog.
     */
    const newCatalog = buildCatalog(
        catalog,
        allMatches,
        selectedSports
    );

    const oldSelection =
        root.competition_selection || {};

    const oldCompetitions =
        root.competitions || {};

    const selection = buildSelection(
        newCatalog,
        oldSelection,
        providerChanged
    );

    /*
     * When the provider changes, reset selections and
     * do not mix records from the previous provider.
     */
    if (providerChanged) {
        console.log(
            "Provider changed. Resetting competition selection."
        );

        await rootRef.update({
            competitions: newCatalog,
            competition_selection: selection,
            matches: {},
            "settings/last_synced_api_provider":
                parser.provider,
            "settings/last_sync_status": "success",
            "settings/last_sync_error": null,
            "settings/last_sync_time": Date.now()
        });

        console.log("Catalog saved. Select competitions next.");
        return;
    }

    /*
     * 4. Determine selected competition matches.
     */
    const selectedMatches = filterMatches(
        allMatches,
        selection,
        selectedSports
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
     * Do not clear existing matches when no competitions
     * have been selected or no selected matches were found.
     */
    if (Object.keys(selectedMatches).length === 0) {
        await rootRef.update(updates);

        console.log(
            "Catalog updated. No selected-competition matches found; existing matches preserved."
        );

        return;
    }

    /*
     * 5. Save matches only after a selection has matches.
     */
    updates.matches = selectedMatches;

    await rootRef.update(updates);

    console.log(
        "Sync complete. Competitions:",
        Object.keys(newCatalog).length
    );

    console.log(
        "Saved matches:",
        Object.keys(selectedMatches).length
    );
}

main().catch(async function (error) {
    console.error("SportsHub sync failed:", error);

    try {
        await db.ref("settings").update({
            last_sync_status: "failed",
            last_sync_error: String(error.message || error),
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
