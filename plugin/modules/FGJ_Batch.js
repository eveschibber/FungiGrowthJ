// v0.2.17 workflow guarantees:
// - REVIEW_DEFERRED items are not automatically opened at session start.
// - They are presented in the end-of-session review queue.
// - Initial image triage can mark an item for later review.
// - Optional review-operation cancellation must return to the review screen,
//   never abort the whole observation.
// - Helper ROI managers are closed silently by Single Image.

// ============================================================
// FungiGrowthJ
//
// Module  : FGJ_Batch
// Version : 0.2.17
// File    : FGJ_Batch.js
//
// PURPOSE
// -------
// Resumable batch-state and traversal prototype with two outputs:
//
//   project_state.json   -> internal workflow state (source of truth)
//   batch_log.csv        -> human-readable audit trail
//
// This release DOES NOT analyze colonies yet.
// It validates safe pause/resume before Batch is connected to
// FGJ_SingleImage.
//
// State transition in this prototype:
//
//   PENDING
//      ↓
//   IN_PROGRESS   [JSON saved BEFORE opening image]
//      ↓
//   TRAVERSED     [image opened/closed successfully]
//
// If Fiji stops while an item is IN_PROGRESS, the next run changes
// it to INTERRUPTED and allows reprocessing.
//
// IMPORTANT:
// TRAVERSED means traversal validated, NOT scientifically analyzed.
// Future releases will assign COMPLETED only after an image result
// CSV exists and is validated.
// ============================================================


// ------------------------------------------------------------
// JAVA CLASSES
// ------------------------------------------------------------

var IJ =
    Java.type("ij.IJ");

var GenericDialog =
    Java.type("ij.gui.GenericDialog");

var DirectoryChooser =
    Java.type("ij.io.DirectoryChooser");

var OpenDialog =
    Java.type("ij.io.OpenDialog");

var ResultsTable =
    Java.type("ij.measure.ResultsTable");

var WindowManager =
    Java.type("ij.WindowManager");

var File =
    Java.type("java.io.File");

var FileReader =
    Java.type("java.io.FileReader");

var BufferedReader =
    Java.type("java.io.BufferedReader");

var FileWriter =
    Java.type("java.io.FileWriter");

var BufferedWriter =
    Java.type("java.io.BufferedWriter");

var StringBuilder =
    Java.type("java.lang.StringBuilder");

var Thread =
    Java.type("java.lang.Thread");

var Date =
    Java.type("java.util.Date");

var SimpleDateFormat =
    Java.type("java.text.SimpleDateFormat");

var AwtColor =
    Java.type("java.awt.Color");

var AwtFont =
    Java.type("java.awt.Font");

var FlowLayout =
    Java.type("java.awt.FlowLayout");

var Label =
    Java.type("java.awt.Label");

var Panel =
    Java.type("java.awt.Panel");


// ============================================================
// CONSTANTS
// ============================================================

var FGJ_BATCH_VERSION = "0.2.17";

var MANIFEST_FILENAME =
    "experiment_manifest.csv";

var PROJECT_STATE_FILENAME =
    "project_state.json";

var BATCH_LOG_FILENAME =
    "batch_log.csv";

var VALID_STATUSES = [
    "PENDING",
    "IN_PROGRESS",
    "INTERRUPTED",
    "REVIEW",
    "TRAVERSED",
    "COMPLETED",
    "ERROR",
    "SKIPPED"
];


// ============================================================
// BASIC HELPERS
// ============================================================

function safeString(value) {

    if (value == null) {
        return "";
    }

    return String(value);
}


function nowTimestamp() {

    var formatter =
        new SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ssZ"
        );

    return String(
        formatter.format(
            new Date()
        )
    );
}


function progressBar(
    current,
    total,
    width
) {

    if (width == null) {
        width = 24;
    }

    var fraction =
        total > 0
        ? current / total
        : 0;

    fraction =
        Math.max(
            0,
            Math.min(
                1,
                fraction
            )
        );

    var filled =
        Math.round(
            fraction * width
        );

    var bar = "";

    for (var i = 0;
         i < width;
         i++) {

        bar +=
            i < filled
            ? "#"
            : "-";
    }

    return "[" +
        bar +
        "] " +
        current +
        "/" +
        total +
        " (" +
        Math.round(
            fraction * 100
        ) +
        "%)";
}


// ============================================================
// CSV HELPERS
// ============================================================

function csvValue(value) {

    if (value == null) {
        return "";
    }

    var text =
        String(value);

    if (
        text.indexOf(",") >= 0 ||
        text.indexOf("\"") >= 0 ||
        text.indexOf("\n") >= 0 ||
        text.indexOf("\r") >= 0
    ) {

        return "\"" +
            text.replace(
                /"/g,
                "\"\""
            ) +
            "\"";
    }

    return text;
}


function csvRow(values) {

    var output = [];

    for (var i = 0;
         i < values.length;
         i++) {

        output.push(
            csvValue(
                values[i]
            )
        );
    }

    return output.join(",");
}


function parseCsvLine(line) {

    var fields = [];
    var current = "";
    var inQuotes = false;

    for (var i = 0;
         i < line.length;
         i++) {

        var ch =
            line.charAt(i);

        if (ch == "\"") {

            if (
                inQuotes &&
                i + 1 < line.length &&
                line.charAt(i + 1) ==
                "\""
            ) {

                current += "\"";
                i++;

            } else {

                inQuotes =
                    !inQuotes;
            }

        } else if (
            ch == "," &&
            !inQuotes
        ) {

            fields.push(
                current
            );

            current = "";

        } else {

            current += ch;
        }
    }

    fields.push(
        current
    );

    return fields;
}


function readCsv(path) {

    var file =
        new File(path);

    if (!file.exists()) {

        throw new Error(
            "CSV file not found:\n" +
            path
        );
    }

    var reader =
        new BufferedReader(
            new FileReader(
                file
            )
        );

    var rows = [];
    var header = null;

    try {

        var line;
        var firstLine = true;

        while (
            (line =
                reader.readLine()) != null
        ) {

            line =
                String(line);

            if (firstLine) {

                header =
                    parseCsvLine(
                        line
                    );

                if (
                    header.length > 0 &&
                    header[0].length > 0 &&
                    header[0]
                        .charCodeAt(0) ==
                    65279
                ) {

                    header[0] =
                        header[0]
                        .substring(1);
                }

                firstLine = false;
                continue;
            }

            if (
                line.trim() == ""
            ) {
                continue;
            }

            var values =
                parseCsvLine(
                    line
                );

            var row = {};

            for (var c = 0;
                 c < header.length;
                 c++) {

                row[
                    header[c]
                ] =
                    c < values.length
                    ? values[c]
                    : "";
            }

            rows.push(
                row
            );
        }

    } finally {

        reader.close();
    }

    return {
        header: header,
        rows: rows
    };
}


// ============================================================
// FILE HELPERS
// ============================================================

function writeTextAtomic(
    destinationPath,
    content
) {

    var destination =
        new File(
            destinationPath
        );

    var temporary =
        new File(
            destinationPath +
            ".tmp"
        );

    var writer =
        new BufferedWriter(
            new FileWriter(
                temporary
            )
        );

    try {

        writer.write(
            String(content)
        );

    } finally {

        writer.close();
    }

    if (
        destination.exists() &&
        !destination.delete()
    ) {

        throw new Error(
            "Could not replace file:\n" +
            destinationPath
        );
    }

    if (
        !temporary.renameTo(
            destination
        )
    ) {

        throw new Error(
            "Could not finalize file:\n" +
            destinationPath
        );
    }
}


function appendLine(
    path,
    line
) {

    var file =
        new File(
            path
        );

    var writer =
        new BufferedWriter(
            new FileWriter(
                file,
                true
            )
        );

    try {

        writer.write(
            String(line)
        );

        writer.newLine();

    } finally {

        writer.close();
    }
}


function readAllText(path) {

    var reader =
        new BufferedReader(
            new FileReader(
                new File(path)
            )
        );

    var builder =
        new StringBuilder();

    try {

        var line;

        while (
            (line =
                reader.readLine()) != null
        ) {

            builder.append(
                String(line)
            );

            builder.append(
                "\n"
            );
        }

    } finally {

        reader.close();
    }

    return String(
        builder.toString()
    );
}


// ============================================================
// JSON HELPERS
// ============================================================
//
// Nashorn has native JSON.parse and JSON.stringify.
//

function saveProjectState(
    path,
    state
) {

    state.last_update =
        nowTimestamp();

    state.batch_version =
        FGJ_BATCH_VERSION;

    var json =
        JSON.stringify(
            state,
            null,
            2
        );

    writeTextAtomic(
        path,
        json
    );
}


function loadProjectState(
    path
) {

    var text =
        readAllText(
            path
        );

    return JSON.parse(
        text
    );
}


// ============================================================
// BATCH LOG
// ============================================================

function ensureBatchLog(
    path
) {

    var file =
        new File(path);

    if (file.exists()) {
        return;
    }

    writeTextAtomic(
        path,
        csvRow([
            "timestamp",
            "batch_item_id",
            "experiment",
            "strain",
            "replicate",
            "plate_id",
            "date_folder",
            "image_path",
            "from_status",
            "to_status",
            "attempt",
            "message",
            "batch_version"
        ]) + "\n"
    );
}


function logTransition(
    logPath,
    item,
    fromStatus,
    toStatus,
    message
) {

    appendLine(
        logPath,
        csvRow([
            nowTimestamp(),
            item.batch_item_id,
            item.experiment,
            item.strain,
            item.replicate,
            item.plate_id,
            item.date_folder,
            item.image_path,
            fromStatus,
            toStatus,
            item.attempts,
            message,
            FGJ_BATCH_VERSION
        ])
    );
}


function setStatus(
    state,
    statePath,
    logPath,
    item,
    newStatus,
    message
) {

    var oldStatus =
        safeString(
            item.status
        );

    item.status =
        newStatus;

    item.last_update =
        nowTimestamp();

    item.last_message =
        safeString(
            message
        );

    saveProjectState(
        statePath,
        state
    );

    logTransition(
        logPath,
        item,
        oldStatus,
        newStatus,
        message
    );
}



// ============================================================
// CROSS-PLATFORM PATH HELPERS
// ============================================================
//
// Manifest paths may have been created on Windows and later used on
// Linux/macOS, or vice versa. Java File.getName() uses the CURRENT
// operating system's separator rules, so a Windows path containing
// backslashes can be misread as one literal filename on Linux.
//
// Always extract basename using BOTH separators.
//

function crossPlatformBasename(pathValue) {

    var path =
        safeString(
            pathValue
        );

    // Do not rely on regex replacement here. Nashorn may receive
    // path values originating from Java/CSV in ways that make
    // separator replacement less predictable across platforms.
    //
    // Instead, find BOTH possible separators and use whichever
    // occurs last.
    var forwardIndex =
        path.lastIndexOf(
            "/"
        );

    var backwardIndex =
        path.lastIndexOf(
            "\\"
        );

    var separatorIndex =
        Math.max(
            forwardIndex,
            backwardIndex
        );

    if (separatorIndex >= 0) {

        return path.substring(
            separatorIndex + 1
        );
    }

    return path;
}


// ============================================================
// IMAGE PATH RESOLUTION
// ============================================================
//
// Do not trust stored absolute paths as the primary way to locate
// images. Experiments may be moved between folders/computers.
//
// Canonical source of location:
//   selected experiment root
//   + strain
//   + replicate
//   + date_folder
//   + original image filename
//

function resolveImageFile(
    experimentFolder,
    item
) {

    var storedPath =
        safeString(
            item.image_path
        ).trim();

    var storedFile =
        new File(
            storedPath
        );

    var imageName =
        crossPlatformBasename(
            storedPath
        );

    var strainFolder =
        new File(
            experimentFolder,
            safeString(
                item.strain
            ).trim()
        );

    var replicateFolder =
        new File(
            strainFolder,
            safeString(
                item.replicate
            ).trim()
        );

    var dateFolder =
        new File(
            replicateFolder,
            safeString(
                item.date_folder
            ).trim()
        );

    var reconstructed =
        new File(
            dateFolder,
            imageName
        );

    // Preferred: path reconstructed from the currently selected root.
    if (reconstructed.exists()) {
        return reconstructed;
    }

    // Additional recovery:
    // if the stored filename/path is stale or malformed, inspect the
    // canonical date folder itself. When exactly one supported image
    // exists there, that image is unambiguous and can safely be used.
    if (dateFolder.exists() &&
        dateFolder.isDirectory()) {

        var dateFiles =
            dateFolder.listFiles();

        var supportedImages = [];

        if (dateFiles != null) {

            for (var recoveryIndex = 0;
                 recoveryIndex < dateFiles.length;
                 recoveryIndex++) {

                var recoveryFile =
                    dateFiles[
                        recoveryIndex
                    ];

                if (!recoveryFile.isFile()) {
                    continue;
                }

                var lowerName =
                    String(
                        recoveryFile.getName()
                    ).toLowerCase();

                if (
                    lowerName.endsWith(".jpg") ||
                    lowerName.endsWith(".jpeg") ||
                    lowerName.endsWith(".png") ||
                    lowerName.endsWith(".tif") ||
                    lowerName.endsWith(".tiff")
                ) {

                    supportedImages.push(
                        recoveryFile
                    );
                }
            }
        }

        if (supportedImages.length == 1) {

            return supportedImages[0];
        }
    }

    // Fallback: original absolute path from manifest/project state.
    if (storedFile.exists()) {
        return storedFile;
    }

    return reconstructed;
}

// ============================================================
// STATE MODEL
// ============================================================

function itemIdFromManifest(row) {

    return safeString(
        row.plate_id
    ) +
    "_" +
    safeString(
        row.date_folder
    );
}


function initialStatusFromManifest(
    row
) {

    var imageCount =
        parseInt(
            safeString(
                row.image_count
            ),
            10
        );

    var imagePath =
        safeString(
            row.primary_image
        );

    var qa =
        safeString(
            row.qa_status
        ).toUpperCase();

    if (
        isNaN(imageCount) ||
        imageCount != 1 ||
        imagePath == ""
    ) {

        return "REVIEW";
    }

    if (
        qa == "ERROR" ||
        qa == "REVIEW"
    ) {

        return "REVIEW";
    }

    return "PENDING";
}


function stateItemFromManifest(
    row
) {

    return {
        batch_item_id:
            itemIdFromManifest(
                row
            ),

        experiment:
            safeString(
                row.experiment
            ),

        strain:
            safeString(
                row.strain
            ),

        replicate:
            safeString(
                row.replicate
            ),

        plate_id:
            safeString(
                row.plate_id
            ),

        date_folder:
            safeString(
                row.date_folder
            ),

        observation_date:
            safeString(
                row.observation_date
            ),

        image_path:
            safeString(
                row.primary_image
            ),

        manifest_qa_status:
            safeString(
                row.qa_status
            ),

        manifest_qa_codes:
            safeString(
                row.qa_codes
            ),

        status:
            initialStatusFromManifest(
                row
            ),

        attempts:
            0,

        last_update:
            nowTimestamp(),

        last_message:
            "",

        result_file:
            "",

        automatic_rois_file:
            "",

        final_rois_file:
            "",

        analysis_revision:
            0,

        analysis_history:
            [],

        analysis_version:
            ""
    };
}


function buildInitialProjectState(
    experimentFolder,
    manifestRows
) {

    var items = [];

    for (var i = 0;
         i < manifestRows.length;
         i++) {

        items.push(
            stateItemFromManifest(
                manifestRows[i]
            )
        );
    }

    return {
        schema_version:
            "1.0",

        project_name:
            safeString(
                experimentFolder
                    .getName()
            ),

        project_path:
            safeString(
                experimentFolder
                    .getAbsolutePath()
            ),

        created_at:
            nowTimestamp(),

        last_update:
            nowTimestamp(),

        batch_version:
            FGJ_BATCH_VERSION,

        replicate_agar_rois:
            {},

        items:
            items
    };
}


// ============================================================
// PATH-ONLY REVIEW MIGRATION REPAIR
// ============================================================
//
// Batch 0.1.2-0.1.4 could incorrectly set an already processed item to
// REVIEW when the absolute path changed only because the experiment
// moved between Windows and Linux/macOS.
//
// Recover the prior status from batch_log.csv when possible.
//

function recoverStatusBeforeFalsePathReview(
    logPath,
    batchItemId
) {

    var logFile =
        new File(
            logPath
        );

    if (!logFile.exists()) {
        return "";
    }

    var logData =
        readCsv(
            logPath
        );

    // Search backwards: the most recent matching false REVIEW transition
    // is the one that matters.
    for (var i =
            logData.rows.length - 1;
         i >= 0;
         i--) {

        var row =
            logData.rows[i];

        if (
            safeString(
                row.batch_item_id
            ) != batchItemId
        ) {
            continue;
        }

        if (
            safeString(
                row.to_status
            ) == "REVIEW" &&
            safeString(
                row.message
            ) ==
            "Image path changed since previous project state."
        ) {

            return safeString(
                row.from_status
            );
        }
    }

    return "";
}


// ============================================================
// MERGE MANIFEST WITH EXISTING PROJECT STATE
// ============================================================

function mergeManifestIntoState(
    state,
    manifestRows,
    statePath,
    logPath
) {

    var existingById = {};

    for (var i = 0;
         i < state.items.length;
         i++) {

        existingById[
            safeString(
                state.items[i]
                    .batch_item_id
            )
        ] =
            state.items[i];
    }

    var merged = [];

    for (var m = 0;
         m < manifestRows.length;
         m++) {

        var manifestRow =
            manifestRows[m];

        var itemId =
            itemIdFromManifest(
                manifestRow
            );

        var previous =
            existingById[
                itemId
            ];

        if (previous == null) {

            previous =
                stateItemFromManifest(
                    manifestRow
                );

            merged.push(
                previous
            );

            logTransition(
                logPath,
                previous,
                "",
                previous.status,
                "New item added from manifest."
            );

            continue;
        }

        var newImagePath =
            safeString(
                manifestRow
                    .primary_image
            );

        if (
            safeString(
                previous.image_path
            ) != newImagePath
        ) {

            var previousFilename =
                crossPlatformBasename(
                    previous.image_path
                );

            var manifestFilename =
                crossPlatformBasename(
                    newImagePath
                );

            // Absolute path differences alone are NOT evidence that the
            // source image changed. This commonly occurs when the same
            // experiment is moved between Windows and Linux/macOS.
            //
            // If the canonical observation identity and filename are the
            // same, preserve the scientific/batch status and let the path
            // resolver refresh the current absolute path later.
            if (
                previousFilename != "" &&
                manifestFilename != "" &&
                previousFilename ==
                manifestFilename
            ) {

                // Repair false REVIEW states created by Batch 0.1.2-0.1.4.
                if (
                    safeString(
                        previous.status
                    ) == "REVIEW" &&
                    safeString(
                        previous.last_message
                    ) ==
                    "Image path changed since previous project state."
                ) {

                    var recoveredStatus =
                        recoverStatusBeforeFalsePathReview(
                            logPath,
                            itemId
                        );

                    if (
                        recoveredStatus != "" &&
                        recoveredStatus != "REVIEW"
                    ) {

                        var falseReviewStatus =
                            previous.status;

                        previous.status =
                            recoveredStatus;

                        previous.last_message =
                            "Recovered previous status after cross-platform path migration.";

                        previous.last_update =
                            nowTimestamp();

                        logTransition(
                            logPath,
                            previous,
                            falseReviewStatus,
                            recoveredStatus,
                            previous.last_message
                        );
                    }
                }

                // Keep the current project-state path for now. The normal
                // resolver will update it to the valid current OS path when
                // this item is actually processed.

            } else {

                // A genuinely different filename within the same
                // plate/date identity requires human review.
                var previousStatus =
                    previous.status;

                previous.image_path =
                    newImagePath;

                previous.status =
                    "REVIEW";

                previous.last_message =
                    "Image filename changed since previous project state.";

                previous.last_update =
                    nowTimestamp();

                logTransition(
                    logPath,
                    previous,
                    previousStatus,
                    "REVIEW",
                    previous.last_message
                );
            }
        }

        previous.experiment =
            safeString(
                manifestRow.experiment
            );

        previous.strain =
            safeString(
                manifestRow.strain
            );

        previous.replicate =
            safeString(
                manifestRow.replicate
            );

        previous.plate_id =
            safeString(
                manifestRow.plate_id
            );

        previous.date_folder =
            safeString(
                manifestRow.date_folder
            );

        previous.observation_date =
            safeString(
                manifestRow
                    .observation_date
            );

        previous.manifest_qa_status =
            safeString(
                manifestRow.qa_status
            );

        previous.manifest_qa_codes =
            safeString(
                manifestRow.qa_codes
            );

        // Migration repair for false REVIEW states left by older Batch
        // prototypes, even when the path strings now happen to match.
        if (
            safeString(
                previous.status
            ) == "REVIEW" &&
            safeString(
                previous.last_message
            ) ==
            "Image path changed since previous project state."
        ) {

            var recoveredLegacyStatus =
                recoverStatusBeforeFalsePathReview(
                    logPath,
                    itemId
                );

            if (
                recoveredLegacyStatus != "" &&
                recoveredLegacyStatus != "REVIEW"
            ) {

                var legacyReview =
                    previous.status;

                previous.status =
                    recoveredLegacyStatus;

                previous.last_message =
                    "Recovered previous status after cross-platform path migration.";

                previous.last_update =
                    nowTimestamp();

                logTransition(
                    logPath,
                    previous,
                    legacyReview,
                    recoveredLegacyStatus,
                    previous.last_message
                );
            }
        }

        if (
            safeString(
                previous.status
            ) ==
            "IN_PROGRESS"
        ) {

            var oldStatus =
                previous.status;

            previous.status =
                "INTERRUPTED";

            previous.last_message =
                "Previous batch session ended while this item was IN_PROGRESS.";

            previous.last_update =
                nowTimestamp();

            logTransition(
                logPath,
                previous,
                oldStatus,
                "INTERRUPTED",
                previous.last_message
            );
        }

        merged.push(
            previous
        );
    }

    state.items =
        merged;

    saveProjectState(
        statePath,
        state
    );

    return state;
}


// ============================================================
// NORMALIZE STORED IMAGE PATHS
// ============================================================
//
// After state migration, an item may have a valid historical status but
// still carry an old Windows/macOS/Linux absolute path. Normalize every
// resolvable item to the path under the experiment root selected now.
//
// IMPORTANT:
// This changes ONLY image_path. It does not change scientific/batch status.
//

function normalizeAllImagePaths(
    projectState,
    experimentFolder,
    statePath,
    logPath
) {

    var changed = 0;

    for (var i = 0;
         i < projectState.items.length;
         i++) {

        var item =
            projectState.items[i];

        var resolved =
            resolveImageFile(
                experimentFolder,
                item
            );

        if (
            resolved != null &&
            resolved.exists()
        ) {

            var resolvedPath =
                String(
                    resolved.getAbsolutePath()
                );

            if (
                safeString(
                    item.image_path
                ) != resolvedPath
            ) {

                var oldPath =
                    safeString(
                        item.image_path
                    );

                item.image_path =
                    resolvedPath;

                item.last_update =
                    nowTimestamp();

                logTransition(
                    logPath,
                    item,
                    item.status,
                    item.status,
                    "Normalized image path from current experiment root. Previous path: " +
                    oldPath
                );

                changed++;
            }
        }
    }

    if (changed > 0) {

        saveProjectState(
            statePath,
            projectState
        );
    }

    return changed;
}


// ============================================================
// SUMMARY
// ============================================================

function countStatuses(
    items
) {

    var counts = {};

    for (var i = 0;
         i < VALID_STATUSES.length;
         i++) {

        counts[
            VALID_STATUSES[i]
        ] = 0;
    }

    for (var r = 0;
         r < items.length;
         r++) {

        var status =
            safeString(
                items[r].status
            ).toUpperCase();

        if (
            counts[status] == null
        ) {
            counts[status] = 0;
        }

        counts[status]++;
    }

    return counts;
}


function showStateTable(
    items
) {

    var table =
        new ResultsTable();

    for (var i = 0;
         i < items.length;
         i++) {

        var row =
            items[i];

        table.incrementCounter();

        table.addValue(
            "batch_item_id",
            row.batch_item_id
        );

        table.addValue(
            "strain",
            row.strain
        );

        table.addValue(
            "replicate",
            row.replicate
        );

        table.addValue(
            "date",
            row.date_folder
        );

        table.addValue(
            "status",
            row.status
        );

        table.addValue(
            "attempts",
            row.attempts
        );

        table.addValue(
            "manifest_qa",
            row.manifest_qa_status
        );

        table.addValue(
            "image",
            row.image_path
        );

        table.addValue(
            "last_message",
            row.last_message
        );
    }

    table.show(
        "FungiGrowthJ Batch State"
    );
}


// ============================================================
// SINGLE IMAGE MODULE LOADER
// ============================================================
//
// Temporary loader for Batch 0.2.
// The final launcher will resolve module paths automatically.
//

function loadSingleImageModule() {

    if (
        typeof FGJ_SingleImage !== "undefined" &&
        FGJ_SingleImage != null &&
        typeof FGJ_SingleImage.run == "function"
    ) {
        return;
    }

    var moduleFile =
        null;

    // Preferred portable route: launcher exposes the modules directory.
    try {

        if (
            typeof FGJ_MODULES_ROOT !== "undefined" &&
            FGJ_MODULES_ROOT != null
        ) {

            var portableCandidate =
                new File(
                    String(FGJ_MODULES_ROOT),
                    "FGJ_SingleImage.js"
                );

            if (
                portableCandidate.exists()
            ) {
                moduleFile =
                    portableCandidate;
            }
        }

    } catch (ignoredPortableModulePath) {}


    // Secondary portable route for direct module execution:
    // locate the most recently loaded script and use its folder.
    if (
        moduleFile == null
    ) {

        try {

            var currentScriptPath =
                IJ.runMacro(
                    'return getInfo("macro.filepath");'
                );

            if (
                currentScriptPath != null &&
                String(currentScriptPath).trim() != ""
            ) {

                var currentScript =
                    new File(
                        String(currentScriptPath)
                    );

                var siblingCandidate =
                    new File(
                        currentScript.getParentFile(),
                        "FGJ_SingleImage.js"
                    );

                if (
                    siblingCandidate.exists()
                ) {
                    moduleFile =
                        siblingCandidate;
                }
            }

        } catch (ignoredSiblingModulePath) {}
    }


    // Legacy fallback only if Batch was run without the launcher and no
    // portable module location could be inferred.
    if (
        moduleFile == null
    ) {

        var moduleDialog =
            new OpenDialog(
                "Select FGJ_SingleImage.js",
                null
            );

        var moduleDirectory =
            moduleDialog.getDirectory();

        var moduleFilename =
            moduleDialog.getFileName();

        if (
            moduleDirectory == null ||
            moduleFilename == null
        ) {

            throw new Error(
                "FGJ_SingleImage module could not be located automatically."
            );
        }

        moduleFile =
            new File(
                moduleDirectory,
                moduleFilename
            );
    }

    FGJ_SUPPRESS_SINGLE_IMAGE_AUTORUN =
        true;

    try {

        load(
            String(
                moduleFile
                    .toURI()
                    .toString()
            )
        );

    } finally {

        FGJ_SUPPRESS_SINGLE_IMAGE_AUTORUN =
            false;
    }

    if (
        typeof FGJ_SingleImage === "undefined" ||
        typeof FGJ_SingleImage.run != "function"
    ) {

        throw new Error(
            "FGJ_SingleImage.js was found but did not define " +
            "FGJ_SingleImage.run()."
        );
    }
}


function ensureExperimentManagerLoaded() {

    if (
        typeof FGJ_ExperimentManager !== "undefined" &&
        FGJ_ExperimentManager != null &&
        typeof FGJ_ExperimentManager.run == "function"
    ) {
        return;
    }

    if (
        typeof FGJ_MODULES_ROOT === "undefined" ||
        FGJ_MODULES_ROOT == null
    ) {

        throw new Error(
            "Experiment manifest is missing and the portable modules " +
            "directory is not available. Run Batch from FungiGrowthJ.js."
        );
    }

    // ExperimentManager depends on FGJ_UI.
    if (
        typeof FGJ_UI === "undefined"
    ) {

        var uiFile =
            new File(
                String(FGJ_MODULES_ROOT),
                "FGJ_UI.js"
            );

        if (
            !uiFile.exists()
        ) {

            throw new Error(
                "Required module not found: " +
                uiFile.getAbsolutePath()
            );
        }

        load(
            String(
                uiFile.toURI().toString()
            )
        );
    }

    var managerFile =
        new File(
            String(FGJ_MODULES_ROOT),
            "FGJ_ExperimentManager.js"
        );

    if (
        !managerFile.exists()
    ) {

        throw new Error(
            "Required module not found: " +
            managerFile.getAbsolutePath()
        );
    }

    load(
        String(
            managerFile.toURI().toString()
        )
    );

    if (
        typeof FGJ_ExperimentManager === "undefined" ||
        typeof FGJ_ExperimentManager.run != "function"
    ) {

        throw new Error(
            "FGJ_ExperimentManager.js did not define " +
            "FGJ_ExperimentManager.run()."
        );
    }
}


function sanitizeFilename(value) {

    return safeString(
        value
    ).replace(
        /[^A-Za-z0-9._-]+/g,
        "_"
    );
}


function resultArtifactsForItem(
    metadataFolder,
    item,
    revision
) {

    var resultFolder =
        new File(
            metadataFolder,
            "results"
        );

    resultFolder =
        new File(
            resultFolder,
            sanitizeFilename(item.strain)
        );

    resultFolder =
        new File(
            resultFolder,
            sanitizeFilename(item.replicate)
        );

    resultFolder =
        new File(
            resultFolder,
            sanitizeFilename(item.date_folder)
        );

    var revisionValue = Math.max(
        1,
        Math.round(Number(revision || 1))
    );

    var revisionLabel = String(revisionValue);
    while (revisionLabel.length < 3) {
        revisionLabel = "0" + revisionLabel;
    }

    var revisionFolder = new File(
        resultFolder,
        "revision_" + revisionLabel
    );

    var imageName = crossPlatformBasename(item.image_path);
    var dot = imageName.lastIndexOf(".");
    var baseName = dot > 0
        ? imageName.substring(0, dot)
        : imageName;

    var safeBase = sanitizeFilename(baseName);

    return {
        folder: revisionFolder,
        csv: new File(
            revisionFolder,
            safeBase + "_FungiGrowthJ_results.csv"
        ),
        automatic_rois: new File(
            revisionFolder,
            safeBase + "_automatic_rois.zip"
        ),
        final_rois: new File(
            revisionFolder,
            safeBase + "_final_rois.zip"
        )
    };
}


function nextAnalysisRevision(item) {

    var current = Number(item.analysis_revision || 0);

    // Legacy completed analyses predate revision tracking. Treat an
    // existing result as revision 1, then create revision 2 on reanalysis.
    if (
        current <= 0 &&
        safeString(item.result_file) != ""
    ) {
        current = 1;
    }

    return current + 1;
}


function archiveCurrentAnalysis(item) {

    if (safeString(item.result_file) == "") {
        return;
    }

    if (item.analysis_history == null) {
        item.analysis_history = [];
    }

    var currentRevision = Number(item.analysis_revision || 0);
    if (currentRevision <= 0) currentRevision = 1;

    item.analysis_history.push({
        revision: currentRevision,
        result_file: safeString(item.result_file),
        automatic_rois_file: safeString(item.automatic_rois_file),
        final_rois_file: safeString(item.final_rois_file),
        analysis_version: safeString(item.analysis_version),
        superseded_at: nowTimestamp()
    });
}


// ============================================================
// STEP 1 — SELECT EXPERIMENT
// ============================================================

var intro =
    new GenericDialog(
        "FungiGrowthJ - Batch 0.2.9"
    );

var introHeader =
    new Panel(new FlowLayout(FlowLayout.LEFT, 5, 0));

var introTitle =
    new Label("BATCH EXPERIMENT ANALYSIS");

introTitle.setFont(
    new AwtFont("SansSerif", AwtFont.BOLD, 15)
);

introTitle.setForeground(
    new AwtColor(0, 105, 125)
);

introHeader.add(introTitle);
intro.addPanel(introHeader);

intro.addMessage(
    "Interactive Experiment Analysis\n\n" +
    "Batch opens each unfinished image automatically and launches\n" +
    "the same Single Image workflow you already validated.\n\n" +
    "After one image is finished:\n" +
    "- its CSV is saved automatically;\n" +
    "- automatic and final ROI sets are saved as ZIP files;\n" +
    "- its state becomes COMPLETED;\n" +
    "- Batch opens the next image.\n\n" +
    "Completed analyses can later be inspected or reanalyzed as a new revision."
);

intro.setOKLabel(
    "Select experiment"
);

intro.showDialog();

if (intro.wasCanceled()) {
    throw "Batch canceled.";
}


var chooser =
    new DirectoryChooser(
        "Select Experiment Folder"
    );

var experimentPath =
    chooser.getDirectory();

if (experimentPath == null) {
    throw "No experiment folder selected.";
}

var experimentFolder =
    new File(
        experimentPath
    );

var metadataFolder =
    new File(
        experimentFolder,
        ".fungigrowthj"
    );

var manifestFile =
    new File(
        metadataFolder,
        MANIFEST_FILENAME
    );

var projectStateFile =
    new File(
        metadataFolder,
        PROJECT_STATE_FILENAME
    );

var batchLogFile =
    new File(
        metadataFolder,
        BATCH_LOG_FILENAME
    );

if (!manifestFile.exists()) {

    ensureExperimentManagerLoaded();

    IJ.showStatus(
        "FungiGrowthJ: new experiment detected; creating manifest..."
    );

    var managerResult =
        FGJ_ExperimentManager.run({
            experiment_folder:
                String(
                    experimentFolder
                        .getAbsolutePath()
                ),

            embedded_batch:
                true
        });

    if (
        managerResult == null ||
        safeString(
            managerResult.status
        ) != "COMPLETED" ||
        !manifestFile.exists()
    ) {

        throw new Error(
            "Experiment validation finished but experiment_manifest.csv " +
            "was not created."
        );
    }
}


loadSingleImageModule();


// ============================================================
// STEP 2 — LOAD MANIFEST + PROJECT STATE
// ============================================================

ensureBatchLog(
    batchLogFile
        .getAbsolutePath()
);

var manifest =
    readCsv(
        manifestFile
            .getAbsolutePath()
    );

var hadPreviousState =
    projectStateFile.exists();

var projectState;

if (hadPreviousState) {

    projectState =
        loadProjectState(
            projectStateFile
                .getAbsolutePath()
        );

    projectState =
        mergeManifestIntoState(
            projectState,
            manifest.rows,
            projectStateFile
                .getAbsolutePath(),
            batchLogFile
                .getAbsolutePath()
        );

} else {

    projectState =
        buildInitialProjectState(
            experimentFolder,
            manifest.rows
        );

    saveProjectState(
        projectStateFile
            .getAbsolutePath(),
        projectState
    );

    for (var initIndex = 0;
         initIndex <
         projectState.items.length;
         initIndex++) {

        logTransition(
            batchLogFile
                .getAbsolutePath(),
            projectState.items[
                initIndex
            ],
            "",
            projectState.items[
                initIndex
            ].status,
            "Initial state created from experiment manifest."
        );
    }
}

var normalizedPathCount =
    normalizeAllImagePaths(
        projectState,
        experimentFolder,
        projectStateFile
            .getAbsolutePath(),
        batchLogFile
            .getAbsolutePath()
    );

// Replicate-level agar references were introduced in Batch 0.2.10.
// Older project_state.json files remain valid and are migrated lazily.
if (
    projectState.replicate_agar_rois == null
) {
    projectState.replicate_agar_rois = {};
    saveProjectState(
        projectStateFile.getAbsolutePath(),
        projectState
    );
}

var counts =
    countStatuses(
        projectState.items
    );

showStateTable(
    projectState.items
);


// ============================================================
// STEP 3 — RESUME CHECKPOINT
// ============================================================

var summary =
    new GenericDialog(
        "FungiGrowthJ - Batch Resume"
    );

var resumeHeader =
    new Panel(new FlowLayout(FlowLayout.LEFT, 5, 0));

var resumeTitle =
    new Label("BATCH CHECKPOINT");

resumeTitle.setFont(
    new AwtFont("SansSerif", AwtFont.BOLD, 15)
);

resumeTitle.setForeground(
    new AwtColor(0, 105, 125)
);

resumeHeader.add(resumeTitle);
summary.addPanel(resumeHeader);

summary.addMessage(
    "Experiment: " +
    projectState.project_name +
    "\n\n" +
    (
        hadPreviousState
        ? "Previous project_state.json found."
        : "New project_state.json created."
    ) +
    "\n\n" +
    "Total items: " +
    projectState.items.length +
    "\n" +
    "Paths normalized this run: " +
    normalizedPathCount +
    "\n" +
    "Pending: " +
    counts.PENDING +
    "\n" +
    "Interrupted: " +
    counts.INTERRUPTED +
    "\n" +
    "Review: " +
    counts.REVIEW +
    "\n" +
    "Traversed: " +
    counts.TRAVERSED +
    "\n" +
    "Completed: " +
    counts.COMPLETED +
    "\n" +
    "Errors: " +
    counts.ERROR +
    "\n" +
    "Skipped: " +
    counts.SKIPPED +
    "\n\n" +
    "Workflow state:\n" +
    projectStateFile
        .getAbsolutePath() +
    "\n\n" +
    "User audit log:\n" +
    batchLogFile
        .getAbsolutePath()
);

summary.addChoice(
    "Action:",
    [
        "Resume unfinished items",
        "Reanalyze one observation",
        "Inspect saved analysis",
        "Analyze all eligible items again",
        "Inspect state only"
    ],
    "Resume unfinished items"
);

summary.addCheckbox(
    "Include REVIEW items",
    false
);

summary.addCheckbox(
    "Retry ERROR items",
    true
);

summary.addNumericField(
    "Stop after N completed analyses (0 = all):",
    5,
    0
);

summary.addCheckbox(
    "Show image during analysis",
    true
);

summary.addCheckbox(
    "Record inoculation origin in every image (for dispersal analysis)",
    projectState.record_inoculation_origin === true
);

summary.addChoice(
    "Scale calibration policy:",
    [
        "Global calibration for entire experiment",
        "Recalibrate every image",
        "Ask before each image"
    ],
    "Global calibration for entire experiment"
);

summary.addChoice(
    "Agar ROI policy:",
    [
        "Reuse fixed agar oval within each replicate",
        "Define agar independently for every image",
        "Ask before each image"
    ],
    "Reuse fixed agar oval within each replicate"
);

if (
    projectState.global_calibration != null
) {

    summary.addCheckbox(
        "Reuse saved global calibration",
        true
    );
}

summary.showDialog();

if (summary.wasCanceled()) {
    throw "Batch resume canceled.";
}

var action =
    summary.getNextChoice();

var includeReview =
    summary.getNextBoolean();

var retryErrors =
    summary.getNextBoolean();

var stopAfter =
    Math.round(
        summary.getNextNumber()
    );

var showImages =
    summary.getNextBoolean();

var recordInoculationOrigin =
    summary.getNextBoolean();

var calibrationPolicyChoice =
    summary.getNextChoice();

var agarPolicyChoice =
    summary.getNextChoice();

var reuseSavedGlobalCalibration =
    projectState.global_calibration != null
    ? summary.getNextBoolean()
    : false;


var selectedTargetBatchItemId = "";

if (
    action == "Reanalyze one observation" ||
    action == "Inspect saved analysis"
) {

    var selectableItems = [];
    var selectableLabels = [];

    for (
        var selectIndex = 0;
        selectIndex < projectState.items.length;
        selectIndex++
    ) {

        var selectableItem =
            projectState.items[selectIndex];

        var selectableStatus =
            safeString(
                selectableItem.status
            ).toUpperCase();

        // Inspection requires an existing saved analysis. Reanalysis is
        // intentionally permissive: any observation in the experiment can
        // be selected, including COMPLETED observations.
        if (
            action == "Inspect saved analysis" &&
            safeString(
                selectableItem.final_rois_file
            ) == ""
        ) {
            continue;
        }

        selectableItems.push(
            selectableItem
        );

        selectableLabels.push(
            safeString(selectableItem.strain) +
            " / " +
            safeString(selectableItem.replicate) +
            " / " +
            safeString(selectableItem.date_folder) +
            "   [" +
            selectableStatus +
            "]"
        );
    }

    if (selectableItems.length == 0) {

        throw new Error(
            action == "Inspect saved analysis"
            ? "No saved analyses with final ROI files are available to inspect."
            : "No experiment observations are available to reanalyze."
        );
    }

    var selectAnalysisDialog =
        new GenericDialog(
            action == "Inspect saved analysis"
            ? "FungiGrowthJ - Inspect Saved Analysis"
            : "FungiGrowthJ - Reanalyze Observation"
        );

    selectAnalysisDialog.addMessage(
        action == "Inspect saved analysis"
        ? "Choose the saved observation you want to inspect."
        : "Choose the observation you want to analyze again.\n\n" +
          "COMPLETED observations are intentionally available here.\n" +
          "A successful new analysis creates a new revision and preserves\n" +
          "the previous result in the analysis history."
    );

    selectAnalysisDialog.addChoice(
        "Observation:",
        selectableLabels,
        selectableLabels[0]
    );

    selectAnalysisDialog.setOKLabel(
        action == "Inspect saved analysis"
        ? "Open analysis"
        : "Reanalyze"
    );

    selectAnalysisDialog.showDialog();

    if (selectAnalysisDialog.wasCanceled()) {
        throw "Observation selection canceled.";
    }

    var selectedObservationIndex =
        selectAnalysisDialog.getNextChoiceIndex();

    var selectedTargetItem =
        selectableItems[selectedObservationIndex];

    selectedTargetBatchItemId =
        safeString(
            selectedTargetItem.batch_item_id
        );
}


projectState.record_inoculation_origin =
    recordInoculationOrigin;

saveProjectState(
    projectStateFile
        .getAbsolutePath(),
    projectState
);

var calibrationMode = "PER_IMAGE";

if (
    calibrationPolicyChoice ==
    "Global calibration for entire experiment"
) {
    calibrationMode = "GLOBAL";
}

if (
    calibrationPolicyChoice ==
    "Ask before each image"
) {
    calibrationMode = "ASK";
}

var agarRoiPolicy = "REUSE_REPLICATE";

if (
    agarPolicyChoice ==
    "Define agar independently for every image"
) {
    agarRoiPolicy = "PER_IMAGE";
}

if (
    agarPolicyChoice ==
    "Ask before each image"
) {
    agarRoiPolicy = "ASK";
}

if (
    calibrationMode == "GLOBAL" &&
    !reuseSavedGlobalCalibration
) {

    // Force the first analyzed image to establish a new global scale.
    projectState.global_calibration =
        null;

    saveProjectState(
        projectStateFile
            .getAbsolutePath(),
        projectState
    );
}

if (action == "Inspect saved analysis") {

    var inspectItem = null;

    for (var inspectIndex = 0;
         inspectIndex < projectState.items.length;
         inspectIndex++) {

        var candidateItem = projectState.items[inspectIndex];

        if (
            safeString(candidateItem.batch_item_id) ==
            selectedTargetBatchItemId
        ) {
            inspectItem = candidateItem;
            break;
        }
    }

    if (inspectItem == null) {
        throw new Error("No matching experiment item was found.");
    }

    if (safeString(inspectItem.final_rois_file) == "") {
        throw new Error(
            "This analysis does not have a saved final ROI set.\n\n" +
            "It was probably completed with an older FungiGrowthJ version.\n" +
            "Use 'Reanalyze one completed image' to create a persistent revision."
        );
    }

    var inspectImageFile = resolveImageFile(
        experimentFolder,
        inspectItem
    );

    var inspectRoiFile = new File(inspectItem.final_rois_file);

    // Portable-project fallback: rebuild the artifact path from the
    // currently selected experiment root if an old absolute path is stale.
    if (!inspectRoiFile.exists()) {
        var inspectRevision = Number(inspectItem.analysis_revision || 1);
        var inspectArtifacts = resultArtifactsForItem(
            metadataFolder,
            inspectItem,
            inspectRevision
        );
        inspectRoiFile = inspectArtifacts.final_rois;
    }

    if (!inspectRoiFile.exists()) {
        throw new Error(
            "Saved final ROI file was not found.\n\n" +
            "Use Reanalyze one completed image to create a new persistent revision."
        );
    }

    var inspectImage = IJ.openImage(inspectImageFile.getAbsolutePath());
    if (inspectImage == null) {
        throw new Error("Could not open the selected source image.");
    }

    inspectImage.show();

    var inspectManager = Packages.ij.plugin.frame.RoiManager.getInstance2();
    if (inspectManager == null) {
        inspectManager = new Packages.ij.plugin.frame.RoiManager();
    } else {
        inspectManager.reset();
    }

    inspectManager.runCommand("Open", inspectRoiFile.getAbsolutePath());
    inspectManager.setVisible(true);
    inspectManager.runCommand(inspectImage, "Show All");

    IJ.showMessage(
        "FungiGrowthJ - Saved Analysis",
        "Loaded saved final ROIs for inspection only.\n\n" +
        "Source image:\n" + inspectImageFile.getAbsolutePath() + "\n\n" +
        "Final ROI set:\n" + inspectRoiFile.getAbsolutePath() + "\n\n" +
        "Opening this analysis does not change results or project state.\n" +
        "To make changes, run Batch again and choose Reanalyze one completed image."
    );

    throw "Saved analysis opened for inspection.";
}


if (action ==
    "Inspect state only") {

    IJ.showMessage(
        "FungiGrowthJ - Batch State",
        "No images were analyzed.\n\n" +
        "Workflow state:\n" +
        projectStateFile
            .getAbsolutePath() +
        "\n\n" +
        "Audit log:\n" +
        batchLogFile
            .getAbsolutePath()
    );

    throw "Batch state inspection completed.";
}


// ============================================================
// STEP 4 — BUILD WORK QUEUE
// ============================================================

var workQueue = [];

for (var q = 0;
     q <
     projectState.items.length;
     q++) {

    var row =
        projectState.items[q];

    var status =
        safeString(
            row.status
        ).toUpperCase();

    var eligible = false;

    if (action == "Reanalyze one observation") {

        // Explicit reanalysis selection overrides normal queue eligibility.
        // This includes COMPLETED observations: they may always be analyzed
        // again as a new revision.
        eligible =
            safeString(row.batch_item_id) ==
            selectedTargetBatchItemId;

    } else if (
        action ==
        "Analyze all eligible items again"
    ) {

        eligible =
            status != "SKIPPED" &&
            status != "REVIEW";

        if (
            includeReview &&
            status == "REVIEW"
        ) {
            eligible = true;
        }

    } else {

        if (
            status == "PENDING" ||
            status == "INTERRUPTED" ||
            status == "TRAVERSED"
        ) {
            eligible = true;
        }

        if (
            retryErrors &&
            status == "ERROR"
        ) {
            eligible = true;
        }

        if (
            includeReview &&
            status == "REVIEW"
        ) {
            eligible = true;
        }
    }

    if (eligible) {

        workQueue.push(
            row
        );
    }
}


if (workQueue.length == 0) {

    if (action == "Reanalyze one observation") {

        IJ.showMessage(
            "FungiGrowthJ - Reanalysis Selection Error",
            "The selected observation could not be added to the reanalysis queue.\n\n" +
            "This should not depend on whether the observation is COMPLETED.\n" +
            "Check project_state.json or the Batch log for the selected item."
        );

    } else {

        IJ.showMessage(
            "FungiGrowthJ - Nothing Pending",
            "There are no eligible items for the selected action.\n\n" +
            "For Resume unfinished items, this simply means there is\n" +
            "nothing left in a resumable state."
        );
    }

    // Clean termination without presenting a script error to the user.
    workQueue = [];
}


// ============================================================
// STEP 5 — TRAVERSE
// ============================================================

var successfulThisRun = 0;
var errorsThisRun = 0;

var startedAt =
    new Date().getTime();


for (var w = 0;
     w < workQueue.length;
     w++) {

    if (
        stopAfter > 0 &&
        successfulThisRun >=
        stopAfter
    ) {

        break;
    }

    var item =
        workQueue[w];

    IJ.showStatus(
        "FungiGrowthJ Batch: " +
        progressBar(
            w,
            workQueue.length,
            20
        ) +
        "  " +
        item.batch_item_id
    );


    // --------------------------------------------------------
    // PROCESSING / REANALYSIS SAFETY
    // --------------------------------------------------------
    //
    // Normal Batch work uses IN_PROGRESS as an interruption-safe state.
    //
    // Explicit reanalysis is different: if a previous completed result
    // exists, that result remains the active valid analysis until the new
    // revision finishes successfully. Reanalysis must NEVER destroy the
    // prior COMPLETED state merely because the new attempt was canceled or
    // failed.
    // --------------------------------------------------------

    var statusBeforeAttempt =
        safeString(
            item.status
        ).toUpperCase();

    var explicitReanalysis =
        action == "Reanalyze one observation";

    var hadPreviousAnalysis =
        safeString(
            item.result_file
        ) != "";

    item.attempts =
        (
            parseInt(
                item.attempts,
                10
            ) || 0
        ) +
        1;

    if (
        explicitReanalysis &&
        hadPreviousAnalysis
    ) {

        item.reanalysis_in_progress = true;
        item.reanalysis_started_at = nowTimestamp();

        saveProjectState(
            projectStateFile
                .getAbsolutePath(),
            projectState
        );

        logTransition(
            batchLogFile
                .getAbsolutePath(),
            item,
            statusBeforeAttempt,
            statusBeforeAttempt,
            "Explicit reanalysis started. Previous analysis remains active until the new revision completes."
        );

    } else {

        setStatus(
            projectState,
            projectStateFile
                .getAbsolutePath(),
            batchLogFile
                .getAbsolutePath(),
            item,
            "IN_PROGRESS",
            "Batch started processing this item."
        );
    }


    var image = null;

    try {

        var imageFile =
            resolveImageFile(
                experimentFolder,
                item
            );

        if (
            !imageFile.exists()
        ) {

            throw new Error(
                "Image file does not exist.\n" +
                "Stored path: " +
                safeString(
                    item.image_path
                ) +
                "\nExtracted filename: " +
                crossPlatformBasename(
                    item.image_path
                ) +
                "\nResolved path: " +
                imageFile
                    .getAbsolutePath()
            );
        }

        // Refresh the project state with the currently valid path.
        var resolvedPath =
            String(
                imageFile
                    .getAbsolutePath()
            );

        if (
            safeString(
                item.image_path
            ) != resolvedPath
        ) {

            item.image_path =
                resolvedPath;

            saveProjectState(
                projectStateFile
                    .getAbsolutePath(),
                projectState
            );

            logTransition(
                batchLogFile
                    .getAbsolutePath(),
                item,
                "IN_PROGRESS",
                "IN_PROGRESS",
                "Image path resolved from current experiment root."
            );
        }

        image =
            IJ.openImage(
                resolvedPath
            );

        if (image == null) {

            throw new Error(
                "Fiji could not open the image.\n" +
                "Resolved path: " +
                resolvedPath
            );
        }

        // SingleImage is interactive, therefore the image must be
        // visible and active for calibration, agar selection and review.
        image.show();

        if (image.getWindow() != null) {

            WindowManager.setCurrentWindow(
                image.getWindow()
            );

            image.getWindow()
                .toFront();
        }

        IJ.showStatus(
            "FungiGrowthJ Batch: " +
            progressBar(
                w + 1,
                workQueue.length,
                20
            ) +
            "  " +
            item.strain +
            " / " +
            item.replicate +
            " / " +
            item.date_folder
        );

        var previousStatus =
            statusBeforeAttempt;

        var isReanalysis =
            explicitReanalysis ||
            previousStatus == "COMPLETED" ||
            hadPreviousAnalysis;

        var analysisRevision =
            nextAnalysisRevision(item);

        var artifacts = resultArtifactsForItem(
            metadataFolder,
            item,
            analysisRevision
        );

        if (!artifacts.folder.exists()) {
            artifacts.folder.mkdirs();
        }

        var resultFile = artifacts.csv;

        var agarReferenceKey =
            safeString(item.strain) +
            "||" +
            safeString(item.replicate);

        var replicateAgarReference =
            projectState.replicate_agar_rois != null &&
            projectState.replicate_agar_rois[agarReferenceKey] != null
            ? projectState.replicate_agar_rois[agarReferenceKey]
            : null;

        var analysisContext = {
            mode:
                "batch",

            batch_item_id:
                item.batch_item_id,

            experiment:
                item.experiment,

            // Canonical metadata names written to the scientific CSV.
            strain_id:
                item.strain,

            replicate_id:
                item.replicate,

            date_raw:
                item.date_folder,

            date:
                item.observation_date,

            // Backward-compatible aliases retained while older modules
            // are still being phased out.
            strain:
                item.strain,

            replicate:
                item.replicate,

            plate_id:
                item.plate_id,

            date_folder:
                item.date_folder,

            observation_date:
                item.observation_date,

            image_path:
                resolvedPath,

            source_image:
                image,

            calibration_mode:
                calibrationMode,

            global_calibration:
                projectState.global_calibration,

            agar_roi_policy:
                agarRoiPolicy,

            agar_reference:
                replicateAgarReference,

            seeded_partition_default:
                true,

            record_inoculation_origin:
                recordInoculationOrigin,

            analysis_revision:
                analysisRevision,

            automatic_rois_path:
                String(artifacts.automatic_rois.getAbsolutePath()),

            final_rois_path:
                String(artifacts.final_rois.getAbsolutePath()),

            output_csv_path:
                String(
                    resultFile
                        .getAbsolutePath()
                )
        };

        var analysisResult = null;
        var singleImageRestartCount = 0;

        while (true) {

            analysisResult =
                FGJ_SingleImage.run(
                    analysisContext
                );

            var singleImageStatus =
                analysisResult == null
                ? ""
                : safeString(
                    analysisResult.status
                );

            if (
                singleImageStatus == "RESTART_NEW_SCALE" ||
                singleImageStatus == "RESTART_NEW_SCALE_AND_AGAR"
            ) {
                singleImageRestartCount++;

                if (singleImageRestartCount > 5) {
                    throw new Error(
                        "Too many navigation restarts for the same image."
                    );
                }

                // Exception to the project/global scale for THIS image only.
                // The stored project calibration remains unchanged.
                analysisContext.calibration_mode =
                    "PER_IMAGE";

                if (
                    singleImageStatus ==
                    "RESTART_NEW_SCALE_AND_AGAR"
                ) {
                    // The user has already established visually that the saved
                    // replicate oval is not appropriate for this photograph.
                    // On restart, do not show/reuse it again: calibrate first,
                    // then run the normal independent agar-definition workflow.
                    analysisContext.agar_roi_policy =
                        "PER_IMAGE";
                }

                continue;
            }

            if (
                singleImageStatus == "RESTART_DETECTION"
            ) {
                singleImageRestartCount++;

                if (singleImageRestartCount > 5) {
                    throw new Error(
                        "Too many navigation restarts for the same image."
                    );
                }

                analysisContext.seeded_partition_default =
                    analysisResult.seeded_partition_default === true;

                // RESTART_DETECTION is not a new analysis setup. Reuse the
                // exact calibration that was already confirmed for this image,
                // including a per-image calibration exception.
                if (
                    analysisResult.calibration != null
                ) {
                    analysisContext.global_calibration =
                        analysisResult.calibration;

                    analysisContext.calibration_mode =
                        "GLOBAL";
                }

                continue;
            }

            if (
                singleImageStatus == "RESTART_REVIEW"
            ) {
                singleImageRestartCount++;

                if (singleImageRestartCount > 5) {
                    throw new Error(
                        "Too many navigation restarts for the same image."
                    );
                }

                if (
                    analysisResult.seeded_partition_default != null
                ) {
                    analysisContext.seeded_partition_default =
                        analysisResult.seeded_partition_default === true;
                }

                continue;
            }

            break;
        }

        if (
            analysisResult != null &&
            safeString(
                analysisResult.status
            ) == "REVIEW_DEFERRED"
        ) {
            setStatus(
                projectState,
                projectStateFile.getAbsolutePath(),
                batchLogFile.getAbsolutePath(),
                item,
                "REVIEW",
                safeString(analysisResult.message) != ""
                ? safeString(analysisResult.message)
                : "Observation deferred by user for later review."
            );

            continue;
        }

        if (
            analysisResult == null ||
            safeString(
                analysisResult.status
            ) != "COMPLETED"
        ) {

            throw new Error(
                "Single Image workflow did not return COMPLETED."
            );
        }

        var verifiedResult =
            new File(
                safeString(
                    analysisResult.result_file
                )
            );

        if (
            !verifiedResult.exists() ||
            verifiedResult.length() <= 0
        ) {

            throw new Error(
                "Single Image returned COMPLETED but the result CSV is missing or empty."
            );
        }


        var verifiedAutomaticRois = new File(
            safeString(analysisResult.automatic_rois_file)
        );

        var verifiedFinalRois = new File(
            safeString(analysisResult.final_rois_file)
        );

        if (
            !verifiedAutomaticRois.exists() ||
            verifiedAutomaticRois.length() <= 0 ||
            !verifiedFinalRois.exists() ||
            verifiedFinalRois.length() <= 0
        ) {
            throw new Error(
                "Single Image returned COMPLETED but ROI persistence files are missing or empty."
            );
        }

        if (isReanalysis) {
            archiveCurrentAnalysis(item);
        }

        item.result_file =
            String(
                verifiedResult
                    .getAbsolutePath()
            );

        item.automatic_rois_file =
            safeString(analysisResult.automatic_rois_file);

        item.final_rois_file =
            safeString(analysisResult.final_rois_file);

        item.analysis_revision =
            Number(analysisResult.analysis_revision || analysisRevision);

        item.analysis_version =
            safeString(
                analysisResult
                    .single_image_version
            );

        // In GLOBAL mode, the first manually calibrated image establishes
        // the project scale. Persist it so later images and resumed sessions
        // can reuse exactly the same physical calibration.
        if (
            calibrationMode == "GLOBAL" &&
            projectState.global_calibration == null &&
            analysisResult.calibration != null
        ) {

            projectState.global_calibration = {
                unit:
                    safeString(
                        analysisResult
                            .calibration
                            .unit
                    ),

                unit_per_pixel:
                    Number(
                        analysisResult
                            .calibration
                            .unit_per_pixel
                    ),

                pixels_per_unit:
                    Number(
                        analysisResult
                            .calibration
                            .pixels_per_unit
                    ),

                known_distance:
                    Number(
                        analysisResult
                            .calibration
                            .known_distance
                    ),

                line_length_pixels:
                    Number(
                        analysisResult
                            .calibration
                            .line_length_pixels
                    ),

                established_from:
                    item.batch_item_id,

                established_at:
                    nowTimestamp(),

                single_image_version:
                    safeString(
                        analysisResult
                            .single_image_version
                    )
            };

            saveProjectState(
                projectStateFile
                    .getAbsolutePath(),
                projectState
            );

            logTransition(
                batchLogFile
                    .getAbsolutePath(),
                item,
                "IN_PROGRESS",
                "IN_PROGRESS",
                "Global calibration established and stored in project_state.json."
            );
        }

        // Persist the first confirmed agar oval for each strain x replicate.
        // The reference stores physical width/height while position remains
        // specific to each photograph. Existing references are never
        // silently replaced by later dates or reanalyses.
        if (
            analysisResult.agar_reference != null &&
            analysisResult.agar_reference.persist === true &&
            projectState.replicate_agar_rois[agarReferenceKey] == null
        ) {
            projectState.replicate_agar_rois[agarReferenceKey] =
                analysisResult.agar_reference;

            saveProjectState(
                projectStateFile.getAbsolutePath(),
                projectState
            );

            logTransition(
                batchLogFile.getAbsolutePath(),
                item,
                "IN_PROGRESS",
                "IN_PROGRESS",
                "Replicate agar reference established and stored for " +
                safeString(item.strain) + "/" +
                safeString(item.replicate) + "."
            );
        }

        item.reanalysis_in_progress = false;
        item.reanalysis_started_at = "";

        setStatus(
            projectState,
            projectStateFile
                .getAbsolutePath(),
            batchLogFile
                .getAbsolutePath(),
            item,
            "COMPLETED",
            "Single Image analysis revision " +
            item.analysis_revision +
            " completed; CSV and ROI persistence files verified."
        );

        successfulThisRun++;

    } catch (error) {

        var batchErrorMessage =
            safeString(
                error
            );

        var preservedPreviousAnalysis =
            explicitReanalysis &&
            hadPreviousAnalysis;

        if (preservedPreviousAnalysis) {

            // A failed/canceled reanalysis does not invalidate the previous
            // completed scientific result.
            item.status =
                statusBeforeAttempt == ""
                ? "COMPLETED"
                : statusBeforeAttempt;

            item.reanalysis_in_progress = false;
            item.reanalysis_started_at = "";
            item.last_reanalysis_error = batchErrorMessage;
            item.last_reanalysis_error_at = nowTimestamp();

            saveProjectState(
                projectStateFile
                    .getAbsolutePath(),
                projectState
            );

            logTransition(
                batchLogFile
                    .getAbsolutePath(),
                item,
                item.status,
                item.status,
                "Reanalysis did not complete; previous analysis preserved. " +
                batchErrorMessage
            );

        } else {

            setStatus(
                projectState,
                projectStateFile
                    .getAbsolutePath(),
                batchLogFile
                    .getAbsolutePath(),
                item,
                "ERROR",
                batchErrorMessage
            );
        }

        errorsThisRun++;

        // Never hide a scientific-workflow failure and silently move on.
        // The user must see which observation failed and decide whether
        // Batch should continue.
        var errorDialog =
            new GenericDialog(
                "FungiGrowthJ - Image Analysis Error"
            );

        var errorHeader =
            new Panel(new FlowLayout(FlowLayout.LEFT, 5, 0));

        var errorTitle =
            new Label("IMAGE ANALYSIS ERROR");

        errorTitle.setFont(
            new AwtFont("SansSerif", AwtFont.BOLD, 15)
        );

        errorTitle.setForeground(
            new AwtColor(175, 55, 35)
        );

        errorHeader.add(errorTitle);
        errorDialog.addPanel(errorHeader);

        errorDialog.addMessage(
            "Batch item: " +
            item.batch_item_id +
            "\n\n" +
            "Strain: " +
            item.strain +
            "\n" +
            "Replicate: " +
            item.replicate +
            "\n" +
            "Date: " +
            item.date_folder +
            "\n\n" +
            "ERROR\n" +
            batchErrorMessage +
            "\n\n" +
            (
                preservedPreviousAnalysis
                ? "The previous completed analysis is still preserved and remains active.\n" +
                  "This failed reanalysis did NOT replace it."
                : "This image was NOT marked COMPLETED."
            )
        );

        errorDialog.addChoice(
            "Batch action:",
            [
                "Stop Batch now",
                "Continue with next image"
            ],
            "Stop Batch now"
        );

        errorDialog.showDialog();

        var errorAction =
            errorDialog.wasCanceled()
            ? "Stop Batch now"
            : errorDialog.getNextChoice();

        if (
            errorAction ==
            "Stop Batch now"
        ) {

            throw new Error(
                "Batch stopped after image error: " +
                item.batch_item_id
            );
        }

    } finally {

        if (image != null) {

            try {

                image.changes =
                    false;

                image.close();

            } catch (closeError) {

                IJ.log(
                    "FungiGrowthJ Batch close warning: " +
                    closeError
                );
            }
        }
    }
}


// ============================================================
// STEP 6 — FINAL SUMMARY
// ============================================================

var finalCounts =
    countStatuses(
        projectState.items
    );

var elapsedMs =
    new Date().getTime() -
    startedAt;

var elapsedSeconds =
    elapsedMs / 1000.0;

showStateTable(
    projectState.items
);

var finish =
    new GenericDialog(
        "FungiGrowthJ - Batch 0.2.17 Complete"
    );

var finishHeader =
    new Panel(new FlowLayout(FlowLayout.LEFT, 5, 0));

var finishTitle =
    new Label("BATCH SESSION COMPLETE");

finishTitle.setFont(
    new AwtFont("SansSerif", AwtFont.BOLD, 16)
);

finishTitle.setForeground(
    errorsThisRun == 0
    ? new AwtColor(0, 120, 70)
    : new AwtColor(175, 70, 25)
);

finishHeader.add(finishTitle);
finish.addPanel(finishHeader);

finish.addMessage(
    "RUN SUMMARY\n" +
    "Completed this run: " + successfulThisRun + "\n" +
    "Errors this run: " + errorsThisRun + "\n" +
    "Elapsed: " + elapsedSeconds.toFixed(1) + " s"
);

var stateHeader =
    new Panel(new FlowLayout(FlowLayout.LEFT, 5, 0));

var stateTitle =
    new Label("CURRENT PROJECT STATE");

stateTitle.setFont(
    new AwtFont("SansSerif", AwtFont.BOLD, 12)
);

stateHeader.add(stateTitle);
finish.addPanel(stateHeader);

finish.addMessage(
    "Pending: " + finalCounts.PENDING +
    "   |   Interrupted: " + finalCounts.INTERRUPTED +
    "   |   Review: " + finalCounts.REVIEW + "\n" +
    "Completed: " + finalCounts.COMPLETED +
    "   |   Errors: " + finalCounts.ERROR +
    "   |   Skipped: " + finalCounts.SKIPPED + "\n" +
    "Traversed: " + finalCounts.TRAVERSED
);

finish.addMessage(
    "\nFILES\n" +
    "Project state:\n" +
    projectStateFile.getAbsolutePath() +
    "\n\nAudit log:\n" +
    batchLogFile.getAbsolutePath() +
    "\n\nTRAVERSED items are unfinished and remain eligible for analysis."
);

finish.setOKLabel(
    "Close Batch"
);

finish.showDialog();
