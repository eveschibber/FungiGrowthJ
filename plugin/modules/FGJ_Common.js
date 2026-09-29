// ============================================================
// FungiGrowthJ
//
// Module  : FGJ_Common
// Version : 0.1.0
// File    : FGJ_Common.js
//
// Public API:
//   FGJ_Common.version()
//   FGJ_Common.padNumber(number, width)
//   FGJ_Common.colonyId(number)
//   FGJ_Common.plateId(strain, replicate)
//   FGJ_Common.normalizeName(value)
//   FGJ_Common.validateDateFolder(name)
//   FGJ_Common.toIsoDate(yyyymmdd)
//   FGJ_Common.isSupportedImageName(name)
//   FGJ_Common.csvValue(value)
//   FGJ_Common.csvRow(values)
//   FGJ_Common.writeTextFile(path, content)
//   FGJ_Common.typeCode(value)
//   FGJ_Common.reviewStatusCode(value)
//   FGJ_Common.reviewFlagCode(value)
//   FGJ_Common.qaStatusRank(status)
//   FGJ_Common.overallQaStatus(statuses)
//   FGJ_Common.addQaIssue(...)
//   FGJ_Common.safeString(value)
//   FGJ_Common.boolCode(value)
//   FGJ_Common.timestamp()
//
// Purpose:
// Shared non-UI utilities for the modular FungiGrowthJ
// architecture.
//
// IMPORTANT:
// This module must NOT contain:
// - dialogs or interface logic;
// - image segmentation;
// - colony measurement algorithms;
// - scientific thresholds.
//
// It provides only reusable infrastructure and data helpers.
// ============================================================


// ------------------------------------------------------------
// MODULE NAMESPACE
// ------------------------------------------------------------

var FGJ_Common =
    typeof FGJ_Common !== "undefined"
    ? FGJ_Common
    : {};

FGJ_Common.VERSION = "0.1.0";
FGJ_Common.MODULE_NAME = "FGJ_Common";


// ------------------------------------------------------------
// JAVA CLASSES
// ------------------------------------------------------------

FGJ_Common._FileWriter =
    Java.type("java.io.FileWriter");

FGJ_Common._BufferedWriter =
    Java.type("java.io.BufferedWriter");

FGJ_Common._Calendar =
    Java.type("java.util.Calendar");

FGJ_Common._SimpleDateFormat =
    Java.type("java.text.SimpleDateFormat");

FGJ_Common._Date =
    Java.type("java.util.Date");


// ============================================================
// VERSION
// ============================================================

FGJ_Common.version = function() {
    return FGJ_Common.VERSION;
};


// ============================================================
// SAFE BASIC HELPERS
// ============================================================

FGJ_Common.safeString = function(value) {

    if (value == null) {
        return "";
    }

    return String(value);
};


FGJ_Common.boolCode = function(value) {

    return value
        ? "Y"
        : "N";
};


FGJ_Common.padNumber =
    function(number, width) {

        var value =
            String(number);

        while (value.length < width) {
            value = "0" + value;
        }

        return value;
    };


// ============================================================
// IDENTIFIERS
// ============================================================


// ------------------------------------------------------------
// Colony ID
// ------------------------------------------------------------
//
// Examples:
//   colonyId(1)   -> C001
//   colonyId(12)  -> C012
//   colonyId(125) -> C125
//

FGJ_Common.colonyId =
    function(number) {

        return "C" +
            FGJ_Common.padNumber(
                number,
                3
            );
    };


// ------------------------------------------------------------
// Plate ID
// ------------------------------------------------------------
//
// Example:
//   strain = S1
//   replicate = R2
//   plateId = S1_R2
//

FGJ_Common.plateId =
    function(
        strain,
        replicate
    ) {

        return (
            FGJ_Common.safeString(
                strain
            ) +
            "_" +
            FGJ_Common.safeString(
                replicate
            )
        );
    };


// ============================================================
// NAME NORMALIZATION
// ============================================================

FGJ_Common.normalizeName =
    function(value) {

        return FGJ_Common
            .safeString(value)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
    };


// ============================================================
// DATE HELPERS
// ============================================================


// ------------------------------------------------------------
// Validate YYYYMMDD date-folder name
// ------------------------------------------------------------

FGJ_Common.validateDateFolder =
    function(name) {

        var text =
            FGJ_Common.safeString(
                name
            );

        if (!/^\d{8}$/.test(text)) {

            return {
                valid: false,
                code:
                    "INVALID_DATE_FORMAT",
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
            FGJ_Common._Calendar
            .getInstance();

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
                FGJ_Common
                    ._Calendar
                    .MILLISECOND,
                0
            );

            calendar.getTime();

        } catch (error) {

            return {
                valid: false,
                code:
                    "INVALID_CALENDAR_DATE",
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
    };


// ------------------------------------------------------------
// Convert YYYYMMDD to YYYY-MM-DD
// ------------------------------------------------------------

FGJ_Common.toIsoDate =
    function(value) {

        var result =
            FGJ_Common
            .validateDateFolder(value);

        return result.valid
            ? result.isoDate
            : "";
    };


// ------------------------------------------------------------
// Current timestamp
// ------------------------------------------------------------

FGJ_Common.timestamp =
    function() {

        var formatter =
            new FGJ_Common
                ._SimpleDateFormat(
                    "yyyy-MM-dd'T'HH:mm:ssZ"
                );

        return String(
            formatter.format(
                new FGJ_Common._Date()
            )
        );
    };


// ============================================================
// IMAGE FILE HELPERS
// ============================================================

FGJ_Common.SUPPORTED_IMAGE_EXTENSIONS = [
    ".jpg",
    ".jpeg",
    ".png",
    ".tif",
    ".tiff"
];


FGJ_Common.isSupportedImageName =
    function(name) {

        var lower =
            FGJ_Common
            .safeString(name)
            .toLowerCase();

        for (
            var i = 0;
            i <
            FGJ_Common
                .SUPPORTED_IMAGE_EXTENSIONS
                .length;
            i++
        ) {

            if (
                lower.endsWith(
                    FGJ_Common
                        .SUPPORTED_IMAGE_EXTENSIONS[
                            i
                        ]
                )
            ) {
                return true;
            }
        }

        return false;
    };


// ============================================================
// CSV HELPERS
// ============================================================


// ------------------------------------------------------------
// Escape a single CSV field
// ------------------------------------------------------------

FGJ_Common.csvValue =
    function(value) {

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
    };


// ------------------------------------------------------------
// Build one CSV row from an array
// ------------------------------------------------------------

FGJ_Common.csvRow =
    function(values) {

        var escaped = [];

        for (
            var i = 0;
            i < values.length;
            i++
        ) {

            escaped.push(
                FGJ_Common.csvValue(
                    values[i]
                )
            );
        }

        return escaped.join(",");
    };


// ------------------------------------------------------------
// Write UTF-compatible text through Java writer
// ------------------------------------------------------------

FGJ_Common.writeTextFile =
    function(path, content) {

        var writer =
            new FGJ_Common
                ._BufferedWriter(
                    new FGJ_Common
                        ._FileWriter(
                            path
                        )
                );

        try {

            writer.write(
                String(content)
            );

        } finally {

            writer.close();
        }
    };


// ============================================================
// SCIENTIFIC CLASSIFICATION CODES
// ============================================================


// ------------------------------------------------------------
// Final / proposed object type
// ------------------------------------------------------------

FGJ_Common.typeCode =
    function(value) {

        if (value == "central") {
            return "CEN";
        }

        if (
            value == "satellite" ||
            value ==
                "candidate_satellite"
        ) {
            return "SAT";
        }

        if (value == "ignore") {
            return "IGN";
        }

        if (value == "defer") {
            return "DEF";
        }

        if (value == "unreviewed") {
            return "UNR";
        }

        return "UNK";
    };


// ------------------------------------------------------------
// Review status
// ------------------------------------------------------------

FGJ_Common.reviewStatusCode =
    function(value) {

        if (value == "confirmed") {
            return "MAN_CONF";
        }

        if (
            value ==
            "auto_accepted_after_preview"
        ) {
            return "AUTO_ACC";
        }

        if (value == "deferred") {
            return "DEF";
        }

        if (value == "pending") {
            return "PEND";
        }

        return "UNK";
    };


// ------------------------------------------------------------
// Review flags
// ------------------------------------------------------------

FGJ_Common.reviewFlagCode =
    function(value) {

        if (
            value == null ||
            value == ""
        ) {
            return "";
        }

        return String(value)
            .replace(
                /low_circularity_after_edit/g,
                "LOW_CIRC_EDIT"
            )
            .replace(
                /low_circularity/g,
                "LOW_CIRC"
            )
            .replace(
                /near_agar_boundary/g,
                "NEAR_EDGE"
            )
            .replace(
                /area_outlier/g,
                "AREA_OUTLIER"
            );
    };


// ============================================================
// QA HELPERS
// ============================================================


// ------------------------------------------------------------
// QA ranking
// ------------------------------------------------------------
//
// Higher number = more restrictive.
//
// PASS   = 1
// REVIEW = 2
// ERROR  = 3
// NA     = 0
//

FGJ_Common.qaStatusRank =
    function(status) {

        status =
            FGJ_Common
            .safeString(status)
            .toUpperCase();

        if (status == "ERROR") {
            return 3;
        }

        if (status == "REVIEW") {
            return 2;
        }

        if (status == "PASS") {
            return 1;
        }

        if (status == "NA") {
            return 0;
        }

        return 2;
    };


// ------------------------------------------------------------
// Most restrictive status from a list
// ------------------------------------------------------------

FGJ_Common.overallQaStatus =
    function(statuses) {

        if (
            statuses == null ||
            statuses.length == 0
        ) {
            return "PASS";
        }

        var highestRank = 0;
        var highestStatus = "PASS";

        for (
            var i = 0;
            i < statuses.length;
            i++
        ) {

            var rank =
                FGJ_Common
                .qaStatusRank(
                    statuses[i]
                );

            if (rank > highestRank) {

                highestRank = rank;

                highestStatus =
                    FGJ_Common
                    .safeString(
                        statuses[i]
                    )
                    .toUpperCase();
            }
        }

        return highestStatus;
    };


// ------------------------------------------------------------
// Add a QA issue to an array
// ------------------------------------------------------------

FGJ_Common.addQaIssue =
    function(
        issues,
        level,
        code,
        scope,
        path,
        message
    ) {

        if (issues == null) {
            throw new Error(
                "QA issues array is required."
            );
        }

        issues.push({
            level:
                FGJ_Common
                .safeString(level)
                .toUpperCase(),

            code:
                FGJ_Common
                .safeString(code),

            scope:
                FGJ_Common
                .safeString(scope),

            path:
                FGJ_Common
                .safeString(path),

            message:
                FGJ_Common
                .safeString(message)
        });
    };


// ------------------------------------------------------------
// QA audit record
// ------------------------------------------------------------

FGJ_Common.qaAuditRecord =
    function(
        checkpoint,
        status,
        code,
        image,
        userAction,
        softwareVersion
    ) {

        return {
            checkpoint:
                FGJ_Common.safeString(
                    checkpoint
                ),

            status:
                FGJ_Common.safeString(
                    status
                ).toUpperCase(),

            code:
                FGJ_Common.safeString(
                    code
                ),

            image:
                FGJ_Common.safeString(
                    image
                ),

            user_action:
                FGJ_Common.safeString(
                    userAction
                ),

            timestamp:
                FGJ_Common.timestamp(),

            software_version:
                FGJ_Common.safeString(
                    softwareVersion
                )
        };
    };


// ============================================================
// GENERIC ARRAY HELPERS
// ============================================================

FGJ_Common.unique =
    function(values) {

        var output = [];
        var seen = {};

        for (
            var i = 0;
            i < values.length;
            i++
        ) {

            var key =
                String(values[i]);

            if (!seen[key]) {

                seen[key] = true;

                output.push(
                    values[i]
                );
            }
        }

        return output;
    };


// ============================================================
// MODULE SELF-CHECK
// ============================================================
//
// Set TRUE only to test this module by itself.
//

var FGJ_COMMON_RUN_SELF_TEST = false;

if (FGJ_COMMON_RUN_SELF_TEST) {

    var testIssues = [];

    FGJ_Common.addQaIssue(
        testIssues,
        "REVIEW",
        "TEST",
        "MODULE",
        "",
        "FGJ_Common self-test."
    );

    print(
        "FGJ_Common " +
        FGJ_Common.version()
    );

    print(
        "Colony ID test: " +
        FGJ_Common.colonyId(7)
    );

    print(
        "Date test: " +
        FGJ_Common.toIsoDate(
            "20260701"
        )
    );

    print(
        "QA test: " +
        FGJ_Common.overallQaStatus(
            [
                "PASS",
                "REVIEW"
            ]
        )
    );
}
