// ============================================================
// FungiGrowthJ
//
// Module  : FGJ_ExperimentManager
// Version : 0.4.3
// File    : FGJ_ExperimentManager.js
//
// Public API:
//   FGJ_ExperimentManager.run()
//
// Purpose:
// Validate the canonical experiment folder hierarchy:
//
//   Experiment/
//     Strain/
//       Replicate/
//         YYYYMMDD/
//           image
//
// Outputs:
//   .fungigrowthj/experiment_manifest.csv
//   .fungigrowthj/experiment_qa_report.csv
//   .fungigrowthj/experiment_summary.txt
//
// IMPORTANT:
// This module encapsulates the validated Experiment Manager 0.4.
// Scientific and QA behavior has not been rewritten.
//
// Batch image processing is NOT implemented in this module.
// ============================================================

var FGJ_ExperimentManager =
    typeof FGJ_ExperimentManager !== "undefined"
    ? FGJ_ExperimentManager
    : {};

FGJ_ExperimentManager.VERSION = "0.4.3";
FGJ_ExperimentManager.MODULE_NAME = "FGJ_ExperimentManager";

// ------------------------------------------------------------
// DEPENDENCIES
// ------------------------------------------------------------

if (typeof FGJ_UI === "undefined") {

    throw new Error(
        "FGJ_UI is not loaded. " +
        "Run/load FGJ_UI.js before this module."
    );
}


FGJ_ExperimentManager.run = function(context) {

    context =
        context == null
        ? {}
        : context;

    var embeddedBatchMode =
        context.embedded_batch === true;

    var suppliedExperimentPath =
        context.experiment_folder != null
        ? String(context.experiment_folder)
        : "";

    // ------------------------------------------------------------
    // JAVA CLASSES
    // ------------------------------------------------------------

    var IJ = Java.type("ij.IJ");
    var DirectoryChooser =
        Java.type("ij.io.DirectoryChooser");
    var SaveDialog =
        Java.type("ij.io.SaveDialog");

    var GenericDialog =
        Java.type("ij.gui.GenericDialog");

    var ResultsTable =
        Java.type("ij.measure.ResultsTable");

    var File =
        Java.type("java.io.File");

    var FileWriter =
        Java.type("java.io.FileWriter");

    var BufferedWriter =
        Java.type("java.io.BufferedWriter");

    var SimpleDateFormat =
        Java.type("java.text.SimpleDateFormat");

    var Calendar =
        Java.type("java.util.Calendar");


    // ============================================================
    // CONSTANTS
    // ============================================================

    var SOFTWARE_VERSION =
        "FGJ_EXPERIMENT_MANAGER_0.4";

    var SUPPORTED_EXTENSIONS = [
        ".jpg",
        ".jpeg",
        ".png",
        ".tif",
        ".tiff"
    ];


    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================




    // ------------------------------------------------------------
    // Determine whether a file is hidden
    // ------------------------------------------------------------

    function isHiddenFile(file) {

        try {
            return file.isHidden() ||
                String(file.getName()).charAt(0) == ".";
        } catch (error) {
            return false;
        }
    }


    // ------------------------------------------------------------
    // Return non-hidden child directories
    // ------------------------------------------------------------

    function listDirectories(parent) {

        var children =
            parent.listFiles();

        var directories = [];

        if (children == null) {
            return directories;
        }

        for (var i = 0; i < children.length; i++) {

            var child =
                children[i];

            if (child.isDirectory() &&
                !isHiddenFile(child)) {

                directories.push(child);
            }
        }

        directories.sort(function(a, b) {
            return String(a.getName())
                .localeCompare(
                    String(b.getName())
                );
        });

        return directories;
    }


    // ------------------------------------------------------------
    // Return non-hidden files
    // ------------------------------------------------------------

    function listFiles(parent) {

        var children =
            parent.listFiles();

        var files = [];

        if (children == null) {
            return files;
        }

        for (var i = 0; i < children.length; i++) {

            var child =
                children[i];

            if (child.isFile() &&
                !isHiddenFile(child)) {

                files.push(child);
            }
        }

        files.sort(function(a, b) {
            return String(a.getName())
                .localeCompare(
                    String(b.getName())
                );
        });

        return files;
    }


    // ------------------------------------------------------------
    // Check whether a file is a supported image
    // ------------------------------------------------------------

    function isSupportedImage(file) {

        var name =
            String(file.getName())
            .toLowerCase();

        for (var i = 0;
             i < SUPPORTED_EXTENSIONS.length;
             i++) {

            if (name.endsWith(
                SUPPORTED_EXTENSIONS[i]
            )) {
                return true;
            }
        }

        return false;
    }


    // ------------------------------------------------------------
    // Validate YYYYMMDD and real calendar date
    // ------------------------------------------------------------

    function validateDateFolder(name) {

        var text =
            String(name);

        if (!/^\d{8}$/.test(text)) {

            return {
                valid: false,
                code: "INVALID_DATE_FORMAT",
                isoDate: ""
            };
        }

        var year =
            parseInt(
                text.substring(0, 4),
                10
            );

        var month =
            parseInt(
                text.substring(4, 6),
                10
            );

        var day =
            parseInt(
                text.substring(6, 8),
                10
            );

        var calendar =
            Calendar.getInstance();

        calendar.setLenient(false);

        try {

            calendar.set(
                year,
                month - 1,
                day,
                0,
                0,
                0
            );

            calendar.set(
                Calendar.MILLISECOND,
                0
            );

            calendar.getTime();

        } catch (error) {

            return {
                valid: false,
                code: "INVALID_CALENDAR_DATE",
                isoDate: ""
            };
        }

        return {
            valid: true,
            code: "",
            isoDate:
                text.substring(0, 4) +
                "-" +
                text.substring(4, 6) +
                "-" +
                text.substring(6, 8)
        };
    }


    // ------------------------------------------------------------
    // Normalize name for duplicate checks
    // ------------------------------------------------------------

    function normalizedName(name) {

        return String(name)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
    }


    // ------------------------------------------------------------
    // Add one QA issue
    // ------------------------------------------------------------

    function addIssue(
        issues,
        level,
        code,
        scope,
        path,
        message
    ) {

        issues.push({
            level: level,
            code: code,
            scope: scope,
            path: path,
            message: message
        });
    }


    // ------------------------------------------------------------
    // Determine overall QA status
    // ------------------------------------------------------------

    function overallStatus(issues) {

        var hasReview = false;

        for (var i = 0;
             i < issues.length;
             i++) {

            if (issues[i].level == "ERROR") {
                return "ERROR";
            }

            if (issues[i].level == "REVIEW") {
                hasReview = true;
            }
        }

        return hasReview
            ? "REVIEW"
            : "PASS";
    }


    // ------------------------------------------------------------
    // CSV-safe value
    // ------------------------------------------------------------

    function csvValue(value) {

        if (value == null) {
            return "";
        }

        var text =
            String(value);

        if (text.indexOf(",") >= 0 ||
            text.indexOf("\"") >= 0 ||
            text.indexOf("\n") >= 0) {

            return "\"" +
                text.replace(/"/g, "\"\"") +
                "\"";
        }

        return text;
    }


    // ------------------------------------------------------------
    // Write text file
    // ------------------------------------------------------------

    function writeTextFile(path, content) {

        var writer =
            new BufferedWriter(
                new FileWriter(path)
            );

        try {
            writer.write(content);
        } finally {
            writer.close();
        }
    }


    // ============================================================
    // STEP 1 — SELECT EXPERIMENT FOLDER
    // ============================================================

    var experimentPath = "";

    if (
        suppliedExperimentPath != ""
    ) {

        experimentPath =
            suppliedExperimentPath;

    } else {

        var welcome =
            new GenericDialog(
                "FungiGrowthJ - Experiment Manager"
            );

        welcome.addMessage(
            FGJ_UI.progressBar(1, 4) + "\n\n" +
            "Select the root folder of the experiment.\n\n" +
            "Expected structure:\n\n" +
            "Experiment/\n" +
            "  strain/\n" +
            "    replicate/\n" +
            "      YYYYMMDD/\n" +
            "        image.jpg\n\n" +
            "The structure will be validated before Batch analysis."
        );

        welcome.setOKLabel(
            "Select folder"
        );

        welcome.showDialog();

        if (
            welcome.wasCanceled()
        ) {
            throw "Experiment Manager canceled.";
        }

        var chooser =
            new DirectoryChooser(
                "Select FungiGrowthJ Experiment Folder"
            );

        experimentPath =
            chooser.getDirectory();

        if (
            experimentPath == null
        ) {
            throw "No experiment folder selected.";
        }
    }

    var experimentFolder =
        new File(
            experimentPath
        );

    if (
        !experimentFolder.exists() ||
        !experimentFolder.isDirectory()
    ) {

        IJ.showMessage(
            "FungiGrowthJ - Folder Error",
            "The selected path is not a valid directory."
        );

        throw "Invalid experiment folder.";
    }


    // ============================================================
    // STEP 2 — SCAN AND VALIDATE STRUCTURE
    // ============================================================

    IJ.showStatus(
        "FungiGrowthJ: validating experiment structure..."
    );

    var experimentName =
        String(
            experimentFolder.getName()
        );

    var issues = [];
    var observations = [];
    var plates = [];

    var strainFolders =
        listDirectories(
            experimentFolder
        );

    if (strainFolders.length == 0) {

        addIssue(
            issues,
            "ERROR",
            "NO_STRAIN_FOLDERS",
            "EXPERIMENT",
            experimentPath,
            "No strain folders were found."
        );
    }


    // ------------------------------------------------------------
    // Detect duplicate strain names after normalization
    // ------------------------------------------------------------

    var normalizedStrains = {};

    for (var s = 0;
         s < strainFolders.length;
         s++) {

        var strainName =
            String(
                strainFolders[s].getName()
            );

        var normalizedStrain =
            normalizedName(
                strainName
            );

        if (normalizedStrains[
            normalizedStrain
        ]) {

            addIssue(
                issues,
                "REVIEW",
                "DUPLICATE_STRAIN_NAME",
                "STRAIN",
                strainFolders[s].getAbsolutePath(),
                "Strain name duplicates another folder after normalization."
            );

        } else {

            normalizedStrains[
                normalizedStrain
            ] = true;
        }
    }


    // ------------------------------------------------------------
    // Traverse strain → replicate → date → image
    // ------------------------------------------------------------

    for (var strainIndex = 0;
         strainIndex < strainFolders.length;
         strainIndex++) {

        var strainFolder =
            strainFolders[strainIndex];

        var strain =
            String(
                strainFolder.getName()
            );

        if (strain.trim() == "") {

            addIssue(
                issues,
                "ERROR",
                "EMPTY_STRAIN_NAME",
                "STRAIN",
                strainFolder.getAbsolutePath(),
                "The strain folder has an empty name."
            );
        }

        var replicateFolders =
            listDirectories(
                strainFolder
            );

        if (replicateFolders.length == 0) {

            addIssue(
                issues,
                "ERROR",
                "NO_REPLICATE_FOLDERS",
                "STRAIN",
                strainFolder.getAbsolutePath(),
                "No replicate folders were found inside this strain."
            );
        }

        var normalizedReplicates = {};

        for (var replicateIndex = 0;
             replicateIndex <
             replicateFolders.length;
             replicateIndex++) {

            var replicateFolder =
                replicateFolders[
                    replicateIndex
                ];

            var replicate =
                String(
                    replicateFolder.getName()
                );

            var normalizedReplicate =
                normalizedName(
                    replicate
                );

            if (normalizedReplicates[
                normalizedReplicate
            ]) {

                addIssue(
                    issues,
                    "REVIEW",
                    "DUPLICATE_REPLICATE_NAME",
                    "REPLICATE",
                    replicateFolder.getAbsolutePath(),
                    "Replicate name duplicates another folder after normalization."
                );

            } else {

                normalizedReplicates[
                    normalizedReplicate
                ] = true;
            }

            var plateId =
                strain + "_" + replicate;

            var dateFolders =
                listDirectories(
                    replicateFolder
                );

            if (dateFolders.length == 0) {

                addIssue(
                    issues,
                    "ERROR",
                    "NO_DATE_FOLDERS",
                    "REPLICATE",
                    replicateFolder.getAbsolutePath(),
                    "No date folders were found inside this replicate."
                );
            }

            var plateObservationCount = 0;
            var plateImageCount = 0;
            var firstDate = "";
            var lastDate = "";
            var plateIssueLevels = [];

            var seenDates = {};

            for (var dateIndex = 0;
                 dateIndex <
                 dateFolders.length;
                 dateIndex++) {

                var dateFolder =
                    dateFolders[
                        dateIndex
                    ];

                var dateFolderName =
                    String(
                        dateFolder.getName()
                    );

                var dateValidation =
                    validateDateFolder(
                        dateFolderName
                    );

                var observationStatus =
                    "PASS";

                var observationCodes = [];

                if (!dateValidation.valid) {

                    observationStatus =
                        "ERROR";

                    observationCodes.push(
                        dateValidation.code
                    );

                    addIssue(
                        issues,
                        "ERROR",
                        dateValidation.code,
                        "OBSERVATION",
                        dateFolder.getAbsolutePath(),
                        "Date folder must use a valid YYYYMMDD value."
                    );
                }

                if (seenDates[
                    dateFolderName
                ]) {

                    observationStatus =
                        "ERROR";

                    observationCodes.push(
                        "DUPLICATE_DATE_FOLDER"
                    );

                    addIssue(
                        issues,
                        "ERROR",
                        "DUPLICATE_DATE_FOLDER",
                        "OBSERVATION",
                        dateFolder.getAbsolutePath(),
                        "Duplicate date folder detected for the same plate."
                    );

                } else {

                    seenDates[
                        dateFolderName
                    ] = true;
                }

                var files =
                    listFiles(
                        dateFolder
                    );

                var imageFiles = [];
                var unsupportedFiles = [];

                for (var fileIndex = 0;
                     fileIndex <
                     files.length;
                     fileIndex++) {

                    if (isSupportedImage(
                        files[fileIndex]
                    )) {

                        imageFiles.push(
                            files[fileIndex]
                        );

                    } else {

                        unsupportedFiles.push(
                            files[fileIndex]
                        );
                    }
                }

                if (files.length == 0) {

                    if (observationStatus != "ERROR") {
                        observationStatus =
                            "REVIEW";
                    }

                    observationCodes.push(
                        "EMPTY_DATE_FOLDER"
                    );

                    addIssue(
                        issues,
                        "REVIEW",
                        "EMPTY_DATE_FOLDER",
                        "OBSERVATION",
                        dateFolder.getAbsolutePath(),
                        "The date folder contains no files."
                    );
                }

                if (unsupportedFiles.length > 0) {

                    if (observationStatus != "ERROR") {
                        observationStatus =
                            "REVIEW";
                    }

                    observationCodes.push(
                        "UNSUPPORTED_FILES"
                    );

                    addIssue(
                        issues,
                        "REVIEW",
                        "UNSUPPORTED_FILES",
                        "OBSERVATION",
                        dateFolder.getAbsolutePath(),
                        unsupportedFiles.length +
                        " unsupported file(s) found."
                    );
                }

                if (imageFiles.length == 0) {

                    if (observationStatus != "ERROR") {
                        observationStatus =
                            "REVIEW";
                    }

                    observationCodes.push(
                        "NO_IMAGE"
                    );

                    addIssue(
                        issues,
                        "REVIEW",
                        "NO_IMAGE",
                        "OBSERVATION",
                        dateFolder.getAbsolutePath(),
                        "No supported image was found."
                    );
                }

                if (imageFiles.length > 1) {

                    if (observationStatus != "ERROR") {
                        observationStatus =
                            "REVIEW";
                    }

                    observationCodes.push(
                        "MULTIPLE_IMAGES"
                    );

                    addIssue(
                        issues,
                        "REVIEW",
                        "MULTIPLE_IMAGES",
                        "OBSERVATION",
                        dateFolder.getAbsolutePath(),
                        imageFiles.length +
                        " supported images found in one date folder."
                    );
                }

                var primaryImage = "";

                if (imageFiles.length > 0) {

                    primaryImage =
                        imageFiles[0]
                        .getAbsolutePath();

                    plateImageCount +=
                        imageFiles.length;
                }

                plateObservationCount++;

                if (dateValidation.valid) {

                    if (firstDate == "" ||
                        dateFolderName <
                        firstDate) {

                        firstDate =
                            dateFolderName;
                    }

                    if (lastDate == "" ||
                        dateFolderName >
                        lastDate) {

                        lastDate =
                            dateFolderName;
                    }
                }

                plateIssueLevels.push(
                    observationStatus
                );

                observations.push({
                    experiment:
                        experimentName,
                    strain:
                        strain,
                    replicate:
                        replicate,
                    plate_id:
                        plateId,
                    date_folder:
                        dateFolderName,
                    observation_date:
                        dateValidation.isoDate,
                    folder_path:
                        dateFolder.getAbsolutePath(),
                    image_count:
                        imageFiles.length,
                    primary_image:
                        primaryImage,
                    qa_status:
                        observationStatus,
                    qa_codes:
                        observationCodes.join(";"),
                    software_version:
                        SOFTWARE_VERSION
                });
            }

            var plateStatus =
                "PASS";

            for (var levelIndex = 0;
                 levelIndex <
                 plateIssueLevels.length;
                 levelIndex++) {

                if (plateIssueLevels[
                    levelIndex
                ] == "ERROR") {

                    plateStatus =
                        "ERROR";
                    break;
                }

                if (plateIssueLevels[
                    levelIndex
                ] == "REVIEW") {

                    plateStatus =
                        "REVIEW";
                }
            }

            plates.push({
                experiment:
                    experimentName,
                strain:
                    strain,
                replicate:
                    replicate,
                plate_id:
                    plateId,
                observations:
                    plateObservationCount,
                images:
                    plateImageCount,
                first_date:
                    firstDate,
                last_date:
                    lastDate,
                qa_status:
                    plateStatus
            });
        }
    }

    var experimentStatus =
        overallStatus(
            issues
        );


    // ============================================================
    // STEP 3 — DISPLAY SUMMARY TABLES
    // ============================================================

    var plateTable =
        new ResultsTable();

    for (var p = 0;
         p < plates.length;
         p++) {

        var plate =
            plates[p];

        plateTable.incrementCounter();

        plateTable.addValue(
            "plate_id",
            plate.plate_id
        );

        plateTable.addValue(
            "strain",
            plate.strain
        );

        plateTable.addValue(
            "replicate",
            plate.replicate
        );

        plateTable.addValue(
            "observation_folders",
            plate.observations
        );

        plateTable.addValue(
            "images",
            plate.images
        );

        plateTable.addValue(
            "first_date",
            plate.first_date
        );

        plateTable.addValue(
            "last_date",
            plate.last_date
        );

        plateTable.addValue(
            "qa_status",
            plate.qa_status
        );
    }

    plateTable.show(
        "FungiGrowthJ Experiment Plates"
    );


    var issueTable =
        new ResultsTable();

    for (var q = 0;
         q < issues.length;
         q++) {

        var issue =
            issues[q];

        issueTable.incrementCounter();

        issueTable.addValue(
            "level",
            issue.level
        );

        issueTable.addValue(
            "code",
            issue.code
        );

        issueTable.addValue(
            "scope",
            issue.scope
        );

        issueTable.addValue(
            "path",
            issue.path
        );

        issueTable.addValue(
            "message",
            issue.message
        );
    }

    if (issues.length > 0) {

        issueTable.show(
            "FungiGrowthJ QA Issues"
        );
    }


    // ------------------------------------------------------------
    // Count QA levels
    // ------------------------------------------------------------

    var errorCount = 0;
    var reviewCount = 0;

    for (var issueIndex = 0;
         issueIndex < issues.length;
         issueIndex++) {

        if (issues[
            issueIndex
        ].level == "ERROR") {

            errorCount++;

        } else if (issues[
            issueIndex
        ].level == "REVIEW") {

            reviewCount++;
        }
    }


    // ============================================================
    // EMBEDDED BATCH — PERSIST QA BEFORE USER CONFIRMATION
    // ============================================================
    //
    // When Experiment Manager is launched automatically by Batch,
    // the validation artifacts are written immediately after scanning.
    //
    // This guarantees that REVIEW / ERROR findings remain documented
    // even if the user cancels at the following QA summary dialog.
    // ============================================================

    if (
        embeddedBatchMode
    ) {

        var earlyOutputFolder =
            new File(
                experimentFolder,
                ".fungigrowthj"
            );

        if (
            !earlyOutputFolder.exists()
        ) {

            var earlyCreated =
                earlyOutputFolder.mkdirs();

            if (
                !earlyCreated &&
                !earlyOutputFolder.exists()
            ) {

                throw new Error(
                    "Could not create .fungigrowthj folder for validation files."
                );
            }
        }


        // --------------------------------------------------------
        // experiment_manifest.csv
        // --------------------------------------------------------

        var earlyManifestLines = [];

        earlyManifestLines.push(
            [
                "experiment",
                "strain",
                "replicate",
                "plate_id",
                "date_folder",
                "observation_date",
                "folder_path",
                "image_count",
                "primary_image",
                "qa_status",
                "qa_codes",
                "software_version"
            ].join(",")
        );

        for (
            var earlyM = 0;
            earlyM < observations.length;
            earlyM++
        ) {

            var earlyObservation =
                observations[
                    earlyM
                ];

            earlyManifestLines.push(
                [
                    earlyObservation.experiment,
                    earlyObservation.strain,
                    earlyObservation.replicate,
                    earlyObservation.plate_id,
                    earlyObservation.date_folder,
                    earlyObservation.observation_date,
                    earlyObservation.folder_path,
                    earlyObservation.image_count,
                    earlyObservation.primary_image,
                    earlyObservation.qa_status,
                    earlyObservation.qa_codes,
                    earlyObservation.software_version
                ]
                .map(csvValue)
                .join(",")
            );
        }

        writeTextFile(
            new File(
                earlyOutputFolder,
                "experiment_manifest.csv"
            ).getAbsolutePath(),
            earlyManifestLines.join("\n")
        );


        // --------------------------------------------------------
        // experiment_qa_report.csv
        // --------------------------------------------------------

        var earlyQaLines = [];

        earlyQaLines.push(
            [
                "level",
                "code",
                "scope",
                "path",
                "message",
                "software_version"
            ].join(",")
        );

        for (
            var earlyR = 0;
            earlyR < issues.length;
            earlyR++
        ) {

            var earlyQaIssue =
                issues[
                    earlyR
                ];

            earlyQaLines.push(
                [
                    earlyQaIssue.level,
                    earlyQaIssue.code,
                    earlyQaIssue.scope,
                    earlyQaIssue.path,
                    earlyQaIssue.message,
                    SOFTWARE_VERSION
                ]
                .map(csvValue)
                .join(",")
            );
        }

        writeTextFile(
            new File(
                earlyOutputFolder,
                "experiment_qa_report.csv"
            ).getAbsolutePath(),
            earlyQaLines.join("\n")
        );


        // --------------------------------------------------------
        // experiment_summary.txt
        // --------------------------------------------------------

        var earlySummaryLines = [];

        earlySummaryLines.push(
            "FungiGrowthJ Experiment Summary"
        );

        earlySummaryLines.push(
            "=============================="
        );

        earlySummaryLines.push(
            ""
        );

        earlySummaryLines.push(
            "Experiment: " +
            experimentName
        );

        earlySummaryLines.push(
            "Root folder: " +
            experimentPath
        );

        earlySummaryLines.push(
            "Strains: " +
            strainFolders.length
        );

        earlySummaryLines.push(
            "Plates: " +
            plates.length
        );

        earlySummaryLines.push(
            "Observation folders: " +
            observations.length
        );

        earlySummaryLines.push(
            "QA errors: " +
            errorCount
        );

        earlySummaryLines.push(
            "QA reviews: " +
            reviewCount
        );

        earlySummaryLines.push(
            "Overall status: " +
            experimentStatus
        );

        earlySummaryLines.push(
            "Software version: " +
            SOFTWARE_VERSION
        );

        earlySummaryLines.push(
            ""
        );

        earlySummaryLines.push(
            "QA files were written automatically before user confirmation."
        );

        writeTextFile(
            new File(
                earlyOutputFolder,
                "experiment_summary.txt"
            ).getAbsolutePath(),
            earlySummaryLines.join("\n")
        );

        IJ.showStatus(
            "FungiGrowthJ: manifest and QA report saved automatically."
        );
    }


    // ------------------------------------------------------------
    // Summary checkpoint
    // ------------------------------------------------------------

    var summaryDialog =
        new GenericDialog(
            "FungiGrowthJ - Experiment QA Summary"
        );

    summaryDialog.addMessage(
        FGJ_UI.progressBar(3, 4) + "\n\n" +
        "Experiment: " +
        experimentName + "\n\n" +
        "Strains: " +
        strainFolders.length + "\n" +
        "Plates: " +
        plates.length + "\n" +
        "Observation folders: " +
        observations.length + "\n" +
        "Images: " +
        observations.reduce(
            function(total, observation) {
                return total +
                    observation.image_count;
            },
            0
        ) + "\n\n" +
        "QA errors: " +
        errorCount + "\n" +
        "QA reviews: " +
        reviewCount + "\n" +
        "Overall status: " +
        experimentStatus + "\n\n" +
        (
            embeddedBatchMode
            ? "Validation files have already been saved in:\n" +
              new File(
                  experimentFolder,
                  ".fungigrowthj"
              ).getAbsolutePath() +
              "\n\n"
            : ""
        ) +
        "Inspect the plate summary and QA issue tables before\n" +
        "confirming the experiment structure."
    );

    summaryDialog.addCheckbox(
        "I reviewed the experiment summary",
        false
    );

    summaryDialog.showDialog();

    if (summaryDialog.wasCanceled()) {
        throw "Experiment validation canceled.";
    }

    var summaryConfirmed =
        summaryDialog.getNextBoolean();

    if (!summaryConfirmed) {

        IJ.showMessage(
            "FungiGrowthJ - Confirmation Required",
            "The experiment structure was not confirmed.\n\n" +
            "Review the tables and run the Experiment Manager again."
        );

        throw "Experiment summary not confirmed.";
    }


    // ============================================================
    // STEP 4 — OPTIONAL EXPORT
    // ============================================================

    var exportManifest = true;
    var exportQa = true;
    var exportSummary = true;

    if (
        !embeddedBatchMode
    ) {

        var exportDialog =
            new GenericDialog(
                "FungiGrowthJ - Export Experiment Validation"
            );

        exportDialog.addMessage(
            FGJ_UI.progressBar(4, 4) + "\n\n" +
            "The experiment structure has been validated.\n\n" +
            "Validation files will be stored inside .fungigrowthj."
        );

        exportDialog.addCheckbox(
            "Export experiment_manifest.csv",
            true
        );

        exportDialog.addCheckbox(
            "Export experiment_qa_report.csv",
            true
        );

        exportDialog.addCheckbox(
            "Export experiment_summary.txt",
            true
        );

        exportDialog.showDialog();

        if (
            exportDialog.wasCanceled()
        ) {
            throw "Experiment export canceled.";
        }

        exportManifest =
            exportDialog.getNextBoolean();

        exportQa =
            exportDialog.getNextBoolean();

        exportSummary =
            exportDialog.getNextBoolean();
    }

    var outputFolder =
        new File(
            experimentFolder,
            ".fungigrowthj"
        );

    if (!outputFolder.exists()) {

        var created =
            outputFolder.mkdirs();

        if (!created &&
            !outputFolder.exists()) {

            IJ.showMessage(
                "FungiGrowthJ - Export Error",
                "Could not create the .fungigrowthj folder."
            );

            throw "Could not create output folder.";
        }
    }


    // ------------------------------------------------------------
    // Export manifest
    // ------------------------------------------------------------

    if (exportManifest) {

        var manifestLines = [];

        manifestLines.push(
            [
                "experiment",
                "strain",
                "replicate",
                "plate_id",
                "date_folder",
                "observation_date",
                "folder_path",
                "image_count",
                "primary_image",
                "qa_status",
                "qa_codes",
                "software_version"
            ].join(",")
        );

        for (var m = 0;
             m < observations.length;
             m++) {

            var observation =
                observations[m];

            manifestLines.push(
                [
                    observation.experiment,
                    observation.strain,
                    observation.replicate,
                    observation.plate_id,
                    observation.date_folder,
                    observation.observation_date,
                    observation.folder_path,
                    observation.image_count,
                    observation.primary_image,
                    observation.qa_status,
                    observation.qa_codes,
                    observation.software_version
                ]
                .map(csvValue)
                .join(",")
            );
        }

        writeTextFile(
            new File(
                outputFolder,
                "experiment_manifest.csv"
            ).getAbsolutePath(),
            manifestLines.join("\n")
        );
    }


    // ------------------------------------------------------------
    // Export QA report
    // ------------------------------------------------------------

    if (exportQa) {

        var qaLines = [];

        qaLines.push(
            [
                "level",
                "code",
                "scope",
                "path",
                "message",
                "software_version"
            ].join(",")
        );

        for (var r = 0;
             r < issues.length;
             r++) {

            var qaIssue =
                issues[r];

            qaLines.push(
                [
                    qaIssue.level,
                    qaIssue.code,
                    qaIssue.scope,
                    qaIssue.path,
                    qaIssue.message,
                    SOFTWARE_VERSION
                ]
                .map(csvValue)
                .join(",")
            );
        }

        writeTextFile(
            new File(
                outputFolder,
                "experiment_qa_report.csv"
            ).getAbsolutePath(),
            qaLines.join("\n")
        );
    }


    // ------------------------------------------------------------
    // Export summary
    // ------------------------------------------------------------

    if (exportSummary) {

        var summaryLines = [];

        summaryLines.push(
            "FungiGrowthJ Experiment Summary"
        );

        summaryLines.push(
            "=============================="
        );

        summaryLines.push(
            ""
        );

        summaryLines.push(
            "Experiment: " +
            experimentName
        );

        summaryLines.push(
            "Root folder: " +
            experimentPath
        );

        summaryLines.push(
            "Strains: " +
            strainFolders.length
        );

        summaryLines.push(
            "Plates: " +
            plates.length
        );

        summaryLines.push(
            "Observation folders: " +
            observations.length
        );

        summaryLines.push(
            "QA errors: " +
            errorCount
        );

        summaryLines.push(
            "QA reviews: " +
            reviewCount
        );

        summaryLines.push(
            "Overall status: " +
            experimentStatus
        );

        summaryLines.push(
            "Software version: " +
            SOFTWARE_VERSION
        );

        summaryLines.push(
            ""
        );

        summaryLines.push(
            "Plate summary"
        );

        summaryLines.push(
            "-------------"
        );

        for (var t = 0;
             t < plates.length;
             t++) {

            var summaryPlate =
                plates[t];

            summaryLines.push(
                summaryPlate.plate_id +
                " | observations=" +
                summaryPlate.observations +
                " | images=" +
                summaryPlate.images +
                " | first=" +
                summaryPlate.first_date +
                " | last=" +
                summaryPlate.last_date +
                " | status=" +
                summaryPlate.qa_status
            );
        }

        writeTextFile(
            new File(
                outputFolder,
                "experiment_summary.txt"
            ).getAbsolutePath(),
            summaryLines.join("\n")
        );
    }


    // ============================================================
    // COMPLETION
    // ============================================================

    if (
        embeddedBatchMode
    ) {

        IJ.showStatus(
            "FungiGrowthJ: experiment manifest created; continuing Batch..."
        );

    } else {

        IJ.showMessage(
            "FungiGrowthJ - Experiment Manager Completed",
            FGJ_UI.progressBar(4, 4) + "\n\n" +
            "Experiment validation completed.\n\n" +
            "Overall QA status: " +
            experimentStatus + "\n\n" +
            "Validation files were saved in:\n" +
            outputFolder.getAbsolutePath() +
            "\n\n" +
            "No images were processed."
        );
    }

    return {
        status:
            "COMPLETED",

        experiment_status:
            experimentStatus,

        experiment_folder:
            String(
                experimentFolder.getAbsolutePath()
            ),

        manifest_path:
            String(
                new File(
                    outputFolder,
                    "experiment_manifest.csv"
                ).getAbsolutePath()
            )
    };

};

// ------------------------------------------------------------
// DIRECT TEST MODE
// ------------------------------------------------------------
// Keep TRUE while validating this module by itself in Fiji.
// When connected to the launcher, change to FALSE and call:
//   FGJ_ExperimentManager.run();
// ------------------------------------------------------------

var FGJ_EXPERIMENT_MANAGER_RUN_DIRECTLY = false;

if (FGJ_EXPERIMENT_MANAGER_RUN_DIRECTLY) {
    FGJ_ExperimentManager.run();
}
