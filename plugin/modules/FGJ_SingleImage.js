// ============================================================
// FungiGrowthJ
//
// Module  : FGJ_SingleImage
// Version : 0.3.70-manual-artifact-eraser
// File    : FGJ_SingleImage.js
//
// Public API:
//   FGJ_SingleImage.run()
//
// v0.3.70 changes:
//   Added an optional manual dark-artifact eraser before colony detection.
//   The user paints unwanted dark objects out of the binary detection mask;
//   the source photograph is never modified. The cleaned mask can be saved
//   alongside the automatic ROI artifact for auditability.
//
// v0.3.59 changes:
//   Added manual colony seed refinement after Enhanced touching-colony partition.
//   Manual seeds now refine ONLY the original connected candidate that contains
//   them; all other proposed ROIs are preserved unchanged.
//   This version is based directly on the validated v0.3.56 manual-mask module.
//
// v0.3.54 changes:
//   Added optional manual polygon exclusion zones before detection.
//   Added manual colony addition from Review Completed with traceability.
//
// v0.3.51 change:
//   Added an automatic border-artifact filter after particle detection.
//   It removes strong peripheral false positives that touch the useful
//   agar boundary, are themselves near that boundary, and show morphology
//   characteristic of a thin/elongated edge trace. Real colonies are not
//   discarded solely because they reach the plate edge.
//
// Purpose:
// Complete guided analysis of one RGB image.
//
// Workflow:
//   1. Set image scale
//   2. Select representative agar sample
//   3. Detect and confirm agar ROI
//   4. Detect colony contours
//   5. Review / classify / edit / manually replace objects
//   6. Export calibrated results
//
// IMPORTANT:
// This module encapsulates the validated Single Image Workflow
// 0.3. Scientific behavior has not been intentionally rewritten.
// ============================================================

var FGJ_SingleImage =
    typeof FGJ_SingleImage !== "undefined"
    ? FGJ_SingleImage
    : {};

FGJ_SingleImage.VERSION = "0.3.74-manual-artifact-eraser-no-getname";
FGJ_SingleImage.MODULE_NAME = "FGJ_SingleImage";

FGJ_SingleImage.run = function(context) {

    context =
        context == null
        ? {}
        : context;

    var fgBatchMode =
        String(
            context.mode || "single"
        ).toLowerCase() ==
        "batch";

    var fgBatchOutputCsv =
        context.output_csv_path != null
        ? String(context.output_csv_path)
        : "";

    var fgBatchItemId =
        context.batch_item_id != null
        ? String(context.batch_item_id)
        : "";

    // Optional persistence paths supplied by Batch.
    var fgAutomaticRoisPath =
        context.automatic_rois_path != null
        ? String(context.automatic_rois_path)
        : "";

    var fgFinalRoisPath =
        context.final_rois_path != null
        ? String(context.final_rois_path)
        : "";

    var fgAnalysisRevision =
        context.analysis_revision != null
        ? Math.max(1, Math.round(Number(context.analysis_revision)))
        : 1;

    // Experimental metadata supplied by Batch.
    // Standalone Single Image runs leave these fields blank unless a
    // caller explicitly provides them.
    var fgExperiment =
        context.experiment != null
        ? String(context.experiment)
        : "";

    var fgStrainId =
        context.strain_id != null
        ? String(context.strain_id)
        : (
            context.strain != null
            ? String(context.strain)
            : ""
        );

    var fgReplicateId =
        context.replicate_id != null
        ? String(context.replicate_id)
        : (
            context.replicate != null
            ? String(context.replicate)
            : ""
        );

    var fgDateRaw =
        context.date_raw != null
        ? String(context.date_raw)
        : (
            context.date_folder != null
            ? String(context.date_folder)
            : ""
        );

    var fgDateIso =
        context.date != null
        ? String(context.date)
        : (
            context.observation_date != null
            ? String(context.observation_date)
            : ""
        );


    // Normalize a YYYYMMDD folder date to ISO YYYY-MM-DD when Batch
    // does not already provide an observation_date.
    if (
        fgDateIso == "" &&
        /^[0-9]{8}$/.test(
            fgDateRaw
        )
    ) {

        fgDateIso =
            fgDateRaw.substring(0, 4) +
            "-" +
            fgDateRaw.substring(4, 6) +
            "-" +
            fgDateRaw.substring(6, 8);
    }


    var fgCalibrationMode =
        context.calibration_mode != null
        ? String(context.calibration_mode)
        : "PER_IMAGE";

    var fgGlobalCalibration =
        context.global_calibration != null
        ? context.global_calibration
        : null;

    var fgExplicitSourceImage =
        context.source_image != null
        ? context.source_image
        : null;

    var fgRecordInoculationOrigin =
        context.record_inoculation_origin === true;

    // Optional per-image restart preference supplied by Batch.
    // null = normal default (enabled); true/false = preselect requested mode.
    var fgSeededPartitionDefault =
        context.seeded_partition_default != null
        ? context.seeded_partition_default === true
        : false;

    // Agar ROI policy supplied by Batch. The plate geometry belongs to a
    // strain x replicate, while its position belongs to each photograph.
    // PER_IMAGE        = detect/define the agar independently in every image.
    // REUSE_REPLICATE  = reuse the fixed reference oval for this replicate.
    // ASK              = ask for each image when a reference is available.
    var fgAgarRoiPolicy =
        context.agar_roi_policy != null
        ? String(context.agar_roi_policy)
        : "PER_IMAGE";

    var fgAgarReference =
        context.agar_reference != null
        ? context.agar_reference
        : null;


    // ============================================================
    // SINGLE-IMAGE WIZARD
    // ============================================================


    // ------------------------------------------------------------
    // JAVA CLASSES
    // ------------------------------------------------------------

    var IJ = Java.type("ij.IJ");
    var ImagePlus = Java.type("ij.ImagePlus");
    var WindowManager = Java.type("ij.WindowManager");

    var DialogListener = Java.type("ij.gui.DialogListener");
    var GenericDialog = Java.type("ij.gui.GenericDialog");
    var NonBlockingGenericDialog =
        Java.type("ij.gui.NonBlockingGenericDialog");
    var Toolbar = Java.type("ij.gui.Toolbar");

    var OvalRoi = Java.type("ij.gui.OvalRoi");
    var PolygonRoi = Java.type("ij.gui.PolygonRoi");
    var PointRoi = Java.type("ij.gui.PointRoi");
    var Roi = Java.type("ij.gui.Roi");
    var ShapeRoi = Java.type("ij.gui.ShapeRoi");
    var Wand = Java.type("ij.gui.Wand");

    var Calibration = Java.type("ij.measure.Calibration");
    var Line = Java.type("ij.gui.Line");

    var ByteProcessor = Java.type("ij.process.ByteProcessor");
    var ColorProcessor = Java.type("ij.process.ColorProcessor");

    var Byte = Java.type("java.lang.Byte");
    var Array = Java.type("java.lang.reflect.Array");

    // AWT components used only to improve review-dialog readability.
    var AwtColor = Java.type("java.awt.Color");
    var AwtFont = Java.type("java.awt.Font");
    var FlowLayout = Java.type("java.awt.FlowLayout");
    var Label = Java.type("java.awt.Label");
    var Panel = Java.type("java.awt.Panel");


    // ------------------------------------------------------------
    // STANDALONE SINGLE IMAGE — OPTIONAL IMAGE METADATA
    // ------------------------------------------------------------
    //
    // Batch already knows experiment, strain, replicate and date from
    // the experiment hierarchy. Standalone mode asks once.
    // Missing values are exported as NA.
    // ------------------------------------------------------------

    if (!fgBatchMode) {

        var Calendar =
            Java.type("java.util.Calendar");

        var LocalDate =
            Java.type("java.time.LocalDate");

        var todayCalendar =
            Calendar.getInstance();

        var currentYear =
            todayCalendar.get(
                Calendar.YEAR
            );

        var currentMonth =
            todayCalendar.get(
                Calendar.MONTH
            ) + 1;

        var currentDay =
            todayCalendar.get(
                Calendar.DAY_OF_MONTH
            );

        var years = [];

        for (
            var yearValue = currentYear + 5;
            yearValue >= 1970;
            yearValue--
        ) {
            years.push(String(yearValue));
        }

        var months = [
            "01 - January",
            "02 - February",
            "03 - March",
            "04 - April",
            "05 - May",
            "06 - June",
            "07 - July",
            "08 - August",
            "09 - September",
            "10 - October",
            "11 - November",
            "12 - December"
        ];

        var days = [];

        for (
            var dayValue = 1;
            dayValue <= 31;
            dayValue++
        ) {
            days.push(
                dayValue < 10
                ? "0" + dayValue
                : String(dayValue)
            );
        }

        var validStandaloneMetadata =
            false;

        while (!validStandaloneMetadata) {

            var metadataDialog =
                new GenericDialog(
                    "FungiGrowthJ - Image Metadata"
                );

            metadataDialog.addMessage(
                "Image metadata (optional)\n\n" +
                "Enter any experimental information known for this image.\n" +
                "Fields left blank are exported as NA."
            );

            metadataDialog.addStringField(
                "Experiment:",
                "",
                24
            );

            metadataDialog.addStringField(
                "Strain ID:",
                "",
                18
            );

            metadataDialog.addStringField(
                "Replicate ID:",
                "",
                18
            );

            metadataDialog.addMessage(
                "\nObservation date"
            );

            metadataDialog.addChoice(
                "Year:",
                years,
                String(currentYear)
            );

            metadataDialog.addChoice(
                "Month:",
                months,
                (
                    currentMonth < 10
                    ? "0" + currentMonth
                    : String(currentMonth)
                ) +
                " - " +
                [
                    "",
                    "January",
                    "February",
                    "March",
                    "April",
                    "May",
                    "June",
                    "July",
                    "August",
                    "September",
                    "October",
                    "November",
                    "December"
                ][currentMonth]
            );

            metadataDialog.addChoice(
                "Day:",
                days,
                currentDay < 10
                ? "0" + currentDay
                : String(currentDay)
            );

            metadataDialog.addCheckbox(
                "Date unknown",
                false
            );

            metadataDialog.setOKLabel(
                "Continue"
            );

            metadataDialog.showDialog();

            if (metadataDialog.wasCanceled()) {
                return {
                    status: "CANCELED",
                    single_image_version:
                        FGJ_SingleImage.VERSION
                };
            }

            var manualExperiment =
                String(
                    metadataDialog.getNextString()
                ).replace(/^\s+|\s+$/g, "");

            var manualStrain =
                String(
                    metadataDialog.getNextString()
                ).replace(/^\s+|\s+$/g, "");

            var manualReplicate =
                String(
                    metadataDialog.getNextString()
                ).replace(/^\s+|\s+$/g, "");

            var selectedYear =
                parseInt(
                    metadataDialog.getNextChoice(),
                    10
                );

            var selectedMonthText =
                metadataDialog.getNextChoice();

            var selectedMonth =
                parseInt(
                    selectedMonthText.substring(0, 2),
                    10
                );

            var selectedDay =
                parseInt(
                    metadataDialog.getNextChoice(),
                    10
                );

            var dateUnknown =
                metadataDialog.getNextBoolean();

            fgExperiment =
                manualExperiment != ""
                ? manualExperiment
                : "NA";

            fgStrainId =
                manualStrain != ""
                ? manualStrain
                : "NA";

            fgReplicateId =
                manualReplicate != ""
                ? manualReplicate
                : "NA";

            if (dateUnknown) {

                fgDateRaw = "NA";
                fgDateIso = "NA";
                validStandaloneMetadata = true;

            } else {

                try {

                    var selectedDate =
                        LocalDate.of(
                            selectedYear,
                            selectedMonth,
                            selectedDay
                        );

                    fgDateIso =
                        String(selectedDate);

                    fgDateRaw =
                        fgDateIso.replace(/-/g, "");

                    validStandaloneMetadata = true;

                } catch (invalidDateError) {

                    IJ.showMessage(
                        "FungiGrowthJ - Invalid Date",
                        "The selected date does not exist.\n\n" +
                        "Please choose a valid day, month and year,\n" +
                        "or select 'Date unknown'."
                    );
                }
            }
        }
    }


    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================


    // ------------------------------------------------------------
    // ASCII progress bar
    // ------------------------------------------------------------

    // ------------------------------------------------------------
    // Numbered workflow step indicator
    // ------------------------------------------------------------
    //
    // Completed steps: teal
    // Current step: dark teal, bold, slightly larger
    // Pending steps: gray
    //
    // This replaces the legacy text progress bar such as [###---].
    // ------------------------------------------------------------

    function addStepIndicator(
        dialog,
        step,
        total
    ) {

        step = Math.max(
            1,
            Math.min(step, total)
        );

        var panel =
            new Panel(
                new FlowLayout(
                    FlowLayout.LEFT,
                    7,
                    0
                )
            );

        var stepLabel =
            new Label(
                "STEP " +
                step +
                " OF " +
                total
            );

        stepLabel.setFont(
            new AwtFont(
                "SansSerif",
                AwtFont.BOLD,
                11
            )
        );

        stepLabel.setForeground(
            new AwtColor(
                85,
                85,
                85
            )
        );

        panel.add(
            stepLabel
        );

        for (
            var i = 1;
            i <= total;
            i++
        ) {

            var numberLabel =
                new Label(
                    String(i)
                );

            if (
                i < step
            ) {

                numberLabel.setForeground(
                    new AwtColor(
                        0,
                        125,
                        145
                    )
                );

                numberLabel.setFont(
                    new AwtFont(
                        "SansSerif",
                        AwtFont.BOLD,
                        12
                    )
                );

            } else if (
                i == step
            ) {

                numberLabel.setForeground(
                    new AwtColor(
                        0,
                        80,
                        100
                    )
                );

                numberLabel.setFont(
                    new AwtFont(
                        "SansSerif",
                        AwtFont.BOLD,
                        15
                    )
                );

            } else {

                numberLabel.setForeground(
                    new AwtColor(
                        145,
                        145,
                        145
                    )
                );

                numberLabel.setFont(
                    new AwtFont(
                        "SansSerif",
                        AwtFont.PLAIN,
                        12
                    )
                );
            }

            panel.add(
                numberLabel
            );
        }

        dialog.addPanel(
            panel
        );
    }


    // ------------------------------------------------------------
    // Calculate mean RGB inside a sample ROI
    // ------------------------------------------------------------

    function calculateSampleColor(
        colorProcessor,
        sampleRoi,
        width,
        height
    ) {
        var bounds = sampleRoi.getBounds();

        var count = 0;
        var sumR = 0;
        var sumG = 0;
        var sumB = 0;

        for (var y = bounds.y;
             y < bounds.y + bounds.height;
             y++) {

            for (var x = bounds.x;
                 x < bounds.x + bounds.width;
                 x++) {

                if (x < 0 || x >= width ||
                    y < 0 || y >= height ||
                    !sampleRoi.contains(x, y)) {

                    continue;
                }

                // ColorProcessor returns one packed 24-bit RGB integer.
                var packedRgb =
                    colorProcessor.getPixel(x, y);

                var red =
                    (packedRgb >> 16) & 255;

                var green =
                    (packedRgb >> 8) & 255;

                var blue =
                    packedRgb & 255;

                sumR += red;
                sumG += green;
                sumB += blue;
                count++;
            }
        }

        if (count === 0) {
            return null;
        }

        return {
            count: count,
            meanR: sumR / count,
            meanG: sumG / count,
            meanB: sumB / count
        };
    }


    // ------------------------------------------------------------
    // Find a white mask pixel near a requested seed location
    // ------------------------------------------------------------

    function findNearestWhitePixel(
        processor,
        startX,
        startY,
        maximumRadius
    ) {
        var width = processor.getWidth();
        var height = processor.getHeight();

        startX = Math.round(startX);
        startY = Math.round(startY);

        if (startX >= 0 && startX < width &&
            startY >= 0 && startY < height &&
            processor.getPixel(startX, startY) === 255) {

            return {
                x: startX,
                y: startY
            };
        }

        for (var radius = 1;
             radius <= maximumRadius;
             radius++) {

            for (var dx = -radius;
                 dx <= radius;
                 dx++) {

                var topX = startX + dx;
                var topY = startY - radius;

                var bottomX = startX + dx;
                var bottomY = startY + radius;

                if (topX >= 0 && topX < width &&
                    topY >= 0 && topY < height &&
                    processor.getPixel(topX, topY) === 255) {

                    return {
                        x: topX,
                        y: topY
                    };
                }

                if (bottomX >= 0 && bottomX < width &&
                    bottomY >= 0 && bottomY < height &&
                    processor.getPixel(bottomX, bottomY) === 255) {

                    return {
                        x: bottomX,
                        y: bottomY
                    };
                }
            }

            for (var dy = -radius + 1;
                 dy <= radius - 1;
                 dy++) {

                var leftX = startX - radius;
                var leftY = startY + dy;

                var rightX = startX + radius;
                var rightY = startY + dy;

                if (leftX >= 0 && leftX < width &&
                    leftY >= 0 && leftY < height &&
                    processor.getPixel(leftX, leftY) === 255) {

                    return {
                        x: leftX,
                        y: leftY
                    };
                }

                if (rightX >= 0 && rightX < width &&
                    rightY >= 0 && rightY < height &&
                    processor.getPixel(rightX, rightY) === 255) {

                    return {
                        x: rightX,
                        y: rightY
                    };
                }
            }
        }

        return null;
    }


    // ------------------------------------------------------------
    // Trace the connected foreground region containing the seed
    // ------------------------------------------------------------

    function traceSeededRegion(
        maskProcessor,
        seedX,
        seedY
    ) {
        var wand = new Wand(maskProcessor);

        wand.autoOutline(
            seedX,
            seedY,
            255,
            255,
            Wand.EIGHT_CONNECTED
        );

        if (wand.npoints <= 2) {
            return null;
        }

        return new PolygonRoi(
            wand.xpoints,
            wand.ypoints,
            wand.npoints,
            Roi.POLYGON
        );
    }


    // ------------------------------------------------------------
    // Build a color-similarity mask
    // ------------------------------------------------------------

    function buildColorMask(
        colorProcessor,
        width,
        height,
        sampleColor,
        tolerance
    ) {
        var pixelCount = width * height;

        var maskPixels =
            Array.newInstance(
                Byte.TYPE,
                pixelCount
            );

        var toleranceSquared =
            tolerance * tolerance;

        for (var y = 0; y < height; y++) {

            for (var x = 0; x < width; x++) {

                var pixelIndex =
                    y * width + x;

                var packedRgb =
                    colorProcessor.getPixel(x, y);

                var red =
                    (packedRgb >> 16) & 255;

                var green =
                    (packedRgb >> 8) & 255;

                var blue =
                    packedRgb & 255;

                var deltaR =
                    red - sampleColor.meanR;

                var deltaG =
                    green - sampleColor.meanG;

                var deltaB =
                    blue - sampleColor.meanB;

                var distanceSquared =
                    deltaR * deltaR +
                    deltaG * deltaG +
                    deltaB * deltaB;

                maskPixels[pixelIndex] =
                    distanceSquared <= toleranceSquared
                    ? -1
                    : 0;
            }
        }

        return new ByteProcessor(
            width,
            height,
            maskPixels,
            null
        );
    }


    // ------------------------------------------------------------
    // Fit a circle to the connected agar region
    // ------------------------------------------------------------

    function fitCircleFromRegion(
        sourceImage,
        regionRoi,
        circleOffsetPercent
    ) {
        if (regionRoi === null) {
            return null;
        }

        sourceImage.setRoi(regionRoi);

        IJ.run(
            sourceImage,
            "Fit Circle",
            ""
        );

        var fittedCircle =
            sourceImage.getRoi();

        if (fittedCircle === null) {
            return null;
        }

        var bounds =
            fittedCircle.getBounds();

        var centerX =
            bounds.x + bounds.width / 2.0;

        var centerY =
            bounds.y + bounds.height / 2.0;

        var radius =
            (bounds.width + bounds.height) / 4.0;

        // Negative values shrink the circle.
        // Positive values expand the circle.
        var usefulRadius =
            radius *
            (1.0 + circleOffsetPercent / 100.0);

        if (usefulRadius <= 1) {
            return null;
        }

        var circleRoi = new OvalRoi(
            centerX - usefulRadius,
            centerY - usefulRadius,
            2.0 * usefulRadius,
            2.0 * usefulRadius
        );

        circleRoi.setStrokeWidth(4.0);

        return circleRoi;
    }


    // ============================================================
    // INITIAL VALIDATION
    // ============================================================

    var sourceImage =
        fgExplicitSourceImage != null
        ? fgExplicitSourceImage
        : WindowManager.getCurrentImage();

    if (sourceImage === null) {

        IJ.showMessage(
            "FungiGrowthJ",
            "Please open an RGB image before starting the wizard."
        );

        throw "No active image.";
    }

    if (sourceImage.getBitDepth() !== 24) {

        IJ.showMessage(
            "FungiGrowthJ - RGB Image Required",
            "This wizard requires the original RGB photograph."
        );

        throw "The active image is not RGB.";
    }


    // ============================================================
    // STEP 1 — SET / REUSE IMAGE SCALE
    // ============================================================

    var scaleLineRoi = null;
    var lineLengthPixels = 0.0;
    var knownDistance = 0.0;
    var scaleUnit = "mm";
    var applyScaleToProject = false;
    var unitPerPixel = 0.0;
    var pixelsPerUnit = 0.0;
    var reusedCalibration = false;

    // One canonical calibration object must exist in BOTH manual and
    // reused-global modes. Later measurement code relies on this object.
    var calibration = null;

    var useSuppliedCalibration = false;

    if (
        fgBatchMode &&
        fgGlobalCalibration != null
    ) {

        if (
            fgCalibrationMode == "GLOBAL"
        ) {

            useSuppliedCalibration = true;

        } else if (
            fgCalibrationMode == "ASK"
        ) {

            var reuseDialog =
                new GenericDialog(
                    "FungiGrowthJ - Scale for " +
                    fgBatchItemId
                );

            addStepIndicator(
                reuseDialog,
                1,
                6


            );



            reuseDialog.addMessage(
                
                "A project calibration is available:\n\n" +
                "Unit: " +
                fgGlobalCalibration.unit +
                "\n" +
                "Pixels per " +
                fgGlobalCalibration.unit +
                ": " +
                Number(
                    fgGlobalCalibration
                        .pixels_per_unit
                ).toFixed(4) +
                "\n\n" +
                "Choose whether to reuse it for this image or draw a new calibration."
            );

            reuseDialog.addChoice(
                "Calibration:",
                [
                    "Reuse project calibration",
                    "Draw a new calibration"
                ],
                "Reuse project calibration"
            );

            reuseDialog.showDialog();

            if (reuseDialog.wasCanceled()) {
                throw "Scale calibration canceled.";
            }

            useSuppliedCalibration =
                reuseDialog.getNextChoice() ==
                "Reuse project calibration";
        }
    }

    if (useSuppliedCalibration) {

        unitPerPixel =
            Number(
                fgGlobalCalibration
                    .unit_per_pixel
            );

        pixelsPerUnit =
            Number(
                fgGlobalCalibration
                    .pixels_per_unit
            );

        scaleUnit =
            String(
                fgGlobalCalibration.unit
            );

        knownDistance =
            Number(
                fgGlobalCalibration
                    .known_distance || 0
            );

        lineLengthPixels =
            Number(
                fgGlobalCalibration
                    .line_length_pixels || 0
            );

        if (
            !isFinite(unitPerPixel) ||
            unitPerPixel <= 0
        ) {

            throw new Error(
                "Stored project calibration is invalid."
            );
        }

        calibration =
            sourceImage
                .getCalibration()
                .copy();

        calibration.pixelWidth =
            unitPerPixel;

        calibration.pixelHeight =
            unitPerPixel;

        calibration.pixelDepth =
            1.0;

        calibration.setUnit(
            scaleUnit
        );

        sourceImage.setCalibration(
            calibration
        );

        reusedCalibration = true;

        var scaleReusedDialog =
            new GenericDialog(
                "FungiGrowthJ - Project Scale Reused"
            );

        var scaleReusedHeader =
            new Panel(
                new FlowLayout(FlowLayout.LEFT, 5, 0)
            );

        var scaleReusedTitle =
            new Label("PROJECT SCALE REUSED");

        scaleReusedTitle.setFont(
            new AwtFont("SansSerif", AwtFont.BOLD, 15)
        );

        scaleReusedTitle.setForeground(
            new AwtColor(0, 120, 70)
        );

        scaleReusedHeader.add(scaleReusedTitle);
        scaleReusedDialog.addPanel(scaleReusedHeader);

        scaleReusedDialog.addMessage(
            "The saved project calibration was applied automatically.\n\n" +
            "SCALE\n" +
            "Pixels per " + scaleUnit + ": " +
            pixelsPerUnit.toFixed(4) + "\n" +
            scaleUnit + " per pixel: " +
            unitPerPixel.toFixed(6) + "\n\n" +
            "No calibration line is required for this image."
        );

        scaleReusedDialog.setOKLabel("Continue");
        scaleReusedDialog.showDialog();

    } else {

        // --------------------------------------------------------
        // Manual calibration
        // --------------------------------------------------------

        var validScaleLine = false;

        while (!validScaleLine) {

            // Ensure THIS source image owns the ROI selection.
            if (sourceImage.getWindow() != null) {
                WindowManager.setCurrentWindow(
                    sourceImage.getWindow()
                );
                sourceImage.getWindow()
                    .toFront();
            }

            var scaleInstructions =
                new NonBlockingGenericDialog(
                    "FungiGrowthJ - Step 1 of 6: Set Image Scale"
                );

            var batchScaleNote = "";

            if (
                fgBatchMode &&
                fgCalibrationMode == "GLOBAL"
            ) {

                batchScaleNote =
                    "\n\nThis calibration will be reused for the remaining images in this Batch.";

            } else if (
                fgBatchMode &&
                fgCalibrationMode == "PER_IMAGE"
            ) {

                batchScaleNote =
                    "\n\nBatch is configured to recalibrate every image.";
            }

            addStepIndicator(
                scaleInstructions,
                1,
                6


            );



            scaleInstructions.addMessage(
                
                "Select a known distance in THIS image.\n\n" +
                "1. Choose Fiji's Straight Line tool.\n" +
                "2. Draw a line over a known distance, such as:\n" +
                "   - several squares of a measurement grid;\n" +
                "   - a ruler segment;\n" +
                "   - another calibrated reference.\n\n" +
                "Using a longer distance, such as 10 or 20 mm,\n" +
                "usually reduces endpoint-placement error." +
                batchScaleNote +
                "\n\nDraw the line now, then press Next."
            );

            scaleInstructions.setOKLabel("Next");
            scaleInstructions.showDialog();

            if (scaleInstructions.wasCanceled()) {
                throw "Scale calibration canceled.";
            }

            // Always read the ROI from the explicit source image.
            scaleLineRoi =
                sourceImage.getRoi();

            if (
                scaleLineRoi !== null &&
                scaleLineRoi.isLine()
            ) {

                validScaleLine = true;
                break;
            }

            var retryScaleDialog =
                new GenericDialog(
                    "FungiGrowthJ - Calibration Line Missing"
                );

            addStepIndicator(
                retryScaleDialog,
                1,
                6


            );



            retryScaleDialog.addMessage(
                
                "No valid calibration line was detected on the current source image.\n\n" +
                "Draw a Straight Line on the photograph currently being analyzed,\n" +
                "then press Try again."
            );

            retryScaleDialog.setOKLabel("Try again");
            retryScaleDialog.showDialog();

            if (retryScaleDialog.wasCanceled()) {
                throw "Scale calibration canceled.";
            }
        }

        // Raw pixel-coordinate length.
        if (scaleLineRoi instanceof Line) {

            var lineDeltaX =
                scaleLineRoi.x2d -
                scaleLineRoi.x1d;

            var lineDeltaY =
                scaleLineRoi.y2d -
                scaleLineRoi.y1d;

            lineLengthPixels =
                Math.sqrt(
                    lineDeltaX * lineDeltaX +
                    lineDeltaY * lineDeltaY
                );

        } else {

            var linePolygon =
                scaleLineRoi
                    .getFloatPolygon();

            if (
                linePolygon == null ||
                linePolygon.npoints < 2
            ) {

                throw "Invalid calibration line.";
            }

            var fallbackDeltaX =
                linePolygon.xpoints[
                    linePolygon.npoints - 1
                ] -
                linePolygon.xpoints[0];

            var fallbackDeltaY =
                linePolygon.ypoints[
                    linePolygon.npoints - 1
                ] -
                linePolygon.ypoints[0];

            lineLengthPixels =
                Math.sqrt(
                    fallbackDeltaX * fallbackDeltaX +
                    fallbackDeltaY * fallbackDeltaY
                );
        }

        if (lineLengthPixels <= 0) {
            throw "Invalid scale line.";
        }

        var scaleDialog =
            new GenericDialog(
                "FungiGrowthJ - Scale Calibration"
            );

        addStepIndicator(
            scaleDialog,
            1,
            6


        );



        scaleDialog.addMessage(
            
            "Selected line length: " +
            lineLengthPixels.toFixed(2) +
            " pixels"
        );

        scaleDialog.addNumericField(
            "Known distance:",
            10.0,
            2
        );

        scaleDialog.addChoice(
            "Unit:",
            [
                "mm",
                "cm",
                "um"
            ],
            "mm"
        );

        if (!fgBatchMode) {

            scaleDialog.addCheckbox(
                "Apply this scale to all images in the project",
                true
            );
        }

        scaleDialog.showDialog();

        if (scaleDialog.wasCanceled()) {
            throw "Scale calibration canceled.";
        }

        knownDistance =
            scaleDialog.getNextNumber();

        scaleUnit =
            scaleDialog.getNextChoice();

        if (!fgBatchMode) {
            applyScaleToProject =
                scaleDialog.getNextBoolean();
        } else {
            applyScaleToProject =
                fgCalibrationMode ==
                "GLOBAL";
        }

        if (knownDistance <= 0) {
            throw "Invalid known distance.";
        }

        unitPerPixel =
            knownDistance /
            lineLengthPixels;

        pixelsPerUnit =
            lineLengthPixels /
            knownDistance;

        if (lineLengthPixels < 20) {

            var shortLineDialog =
                new GenericDialog(
                    "FungiGrowthJ - Calibration Warning"
                );

            shortLineDialog.addMessage(
                "The selected reference line is only " +
                lineLengthPixels.toFixed(2) +
                " pixels long.\n\n" +
                "This may produce inaccurate physical measurements.\n" +
                "A longer reference distance is recommended."
            );

            shortLineDialog.addCheckbox(
                "Continue with this calibration",
                false
            );

            shortLineDialog.showDialog();

            if (
                shortLineDialog.wasCanceled() ||
                !shortLineDialog
                    .getNextBoolean()
            ) {
                throw "Calibration rejected because the line was too short.";
            }
        }

        calibration =
            sourceImage
                .getCalibration()
                .copy();

        calibration.pixelWidth =
            unitPerPixel;

        calibration.pixelHeight =
            unitPerPixel;

        calibration.pixelDepth =
            1.0;

        calibration.setUnit(
            scaleUnit
        );

        sourceImage.setCalibration(
            calibration
        );

        sourceImage.deleteRoi();

        IJ.showMessage(
            "FungiGrowthJ - Scale Set",
            "Image calibration completed.\n\n" +
            "Line length: " +
            lineLengthPixels.toFixed(2) +
            " pixels\n" +
            "Known distance: " +
            knownDistance.toFixed(2) +
            " " +
            scaleUnit +
            "\n" +
            "Pixels per " +
            scaleUnit +
            ": " +
            pixelsPerUnit.toFixed(4) +
            "\n" +
            scaleUnit +
            " per pixel: " +
            unitPerPixel.toFixed(6)
        );
    }


    // ============================================================
    // STEP 2 — SELECT A REPRESENTATIVE AGAR SAMPLE
    // ============================================================
    //
    // The agar sample and interactive plate detection are wrapped in
    // a retry loop. The user can return here from the plate-confirmation
    // screen without restarting calibration or the whole image workflow.
    //

    var sampleRoi = null;
    var acceptedRoi = null;
    var manuallyAdjusted = false;

    // Traceability for how the final useful-agar geometry was obtained.
    // automatic        = automatic ROI accepted as proposed
    // automatic_edited = automatic ROI resized/repositioned manually
    // manual           = ROI drawn from scratch by the user
    var agarRoiSource = "automatic";

    // Replicate-level agar reference traceability. A reference stores the
    // physical width/height of the confirmed oval, not its absolute image
    // coordinates. Each later photograph may therefore reposition it.
    var agarReferenceUsed = false;
    var agarReferenceEstablished = false;
    var agarReferenceResizeAllowed = false;
    var agarReferenceSourceDate = "";
    var agarReferenceMoved = false;
    var agarReferenceResized = false;
    var agarReferenceShouldPersist = false;

    var agarSelectionCompleted = false;


    // ------------------------------------------------------------
    // MANUAL AGAR ROI FALLBACK
    // ------------------------------------------------------------
    //
    // Used when automatic RGB-seeded plate detection is not useful.
    // The user draws the useful agar boundary directly with Fiji's
    // Oval Selection tool. An ellipse is allowed because perspective
    // may make a circular Petri dish appear elliptical.
    // ------------------------------------------------------------

    function captureManualAgarRoi() {

        sourceImage.deleteRoi();

        if (
            sourceImage.getWindow() != null
        ) {

            WindowManager.setCurrentWindow(
                sourceImage.getWindow()
            );

            sourceImage
                .getWindow()
                .toFront();
        }

        while (true) {

            var manualAgarDialog =
                new NonBlockingGenericDialog(
                    "FungiGrowthJ - Draw Agar ROI Manually"
                );

            addStepIndicator(
                manualAgarDialog,
                3,
                6


            );



            manualAgarDialog.addMessage(
                
                "DRAW THE USEFUL AGAR BOUNDARY MANUALLY\n\n" +
                "1. Select Fiji's Oval Selection tool.\n" +
                "2. Draw an oval/ellipse around the useful agar region.\n" +
                "3. Follow the agar boundary, not the outer glass/plastic edge.\n" +
                "4. Leave the final ROI active on the image.\n" +
                "5. Press 'Use manual agar ROI'.\n\n" +
                "A perfect circle is not required; a slightly elliptical ROI\n" +
                "is appropriate when the photograph contains perspective."
            );

            manualAgarDialog.setOKLabel(
                "Use manual agar ROI"
            );

            manualAgarDialog.showDialog();

            if (
                manualAgarDialog.wasCanceled()
            ) {
                return null;
            }

            var manualAgarRoi =
                sourceImage.getRoi();

            if (
                manualAgarRoi != null &&
                manualAgarRoi instanceof OvalRoi
            ) {

                try {
                    manualAgarRoi =
                        manualAgarRoi.clone();
                } catch (ignoredManualAgarClone) {}

                return manualAgarRoi;
            }

            IJ.showMessage(
                "FungiGrowthJ - Manual Agar ROI",
                "A valid Oval ROI was not detected.\n\n" +
                "Use Fiji's Oval Selection tool, draw the useful agar\n" +
                "boundary, and try again."
            );
        }
    }


    // ------------------------------------------------------------
    // REPLICATE-LEVEL AGAR REFERENCE
    // ------------------------------------------------------------
    // When the same physical Petri dish is photographed repeatedly, the
    // agar oval can be reused within the same strain x replicate. The oval
    // is reconstructed from physical dimensions using the calibration of
    // the current image, then the user only needs to position it.
    //
    // Scientific rule:
    // - If the project/global calibration was reused, size is LOCKED.
    // - If this image was newly calibrated, resizing is allowed because the
    //   pixel representation may legitimately differ from the project scale.
    // - The independent per-image workflow remains available as an option.

    var useReplicateAgarReference = false;

    // A replicate reference is always previewed on the image before the
    // per-image decision is made. The Batch policy controls the default
    // workflow, but never removes the user's ability to change course after
    // seeing whether the saved oval actually matches this photograph.
    if (
        fgAgarReference != null &&
        fgAgarRoiPolicy != "PER_IMAGE"
    ) {
        useReplicateAgarReference = true;
    }

    if (useReplicateAgarReference) {

        var referenceUnit =
            fgAgarReference.scale_unit != null
            ? String(fgAgarReference.scale_unit)
            : scaleUnit;

        var referenceWidthPhysical =
            Number(
                fgAgarReference.width_physical
            );

        var referenceHeightPhysical =
            Number(
                fgAgarReference.height_physical
            );

        if (
            referenceUnit != scaleUnit ||
            !isFinite(referenceWidthPhysical) ||
            referenceWidthPhysical <= 0 ||
            !isFinite(referenceHeightPhysical) ||
            referenceHeightPhysical <= 0
        ) {
            throw new Error(
                "Stored replicate agar reference is incompatible with the current calibration."
            );
        }

        var referenceWidthPx =
            referenceWidthPhysical /
            calibration.pixelWidth;

        var referenceHeightPx =
            referenceHeightPhysical /
            calibration.pixelHeight;

        var centerFractionX =
            Number(
                fgAgarReference.center_fraction_x
            );

        var centerFractionY =
            Number(
                fgAgarReference.center_fraction_y
            );

        if (!isFinite(centerFractionX)) {
            centerFractionX = 0.5;
        }

        if (!isFinite(centerFractionY)) {
            centerFractionY = 0.5;
        }

        var referenceCenterX =
            centerFractionX *
            sourceImage.getWidth();

        var referenceCenterY =
            centerFractionY *
            sourceImage.getHeight();

        var referenceOval =
            new OvalRoi(
                referenceCenterX - referenceWidthPx / 2.0,
                referenceCenterY - referenceHeightPx / 2.0,
                referenceWidthPx,
                referenceHeightPx
            );

        sourceImage.setRoi(
            referenceOval
        );

        agarReferenceResizeAllowed =
            !reusedCalibration;

        agarReferenceSourceDate =
            fgAgarReference.established_date != null
            ? String(fgAgarReference.established_date)
            : "";

        var referencePlacementDone = false;

        while (!referencePlacementDone) {

            if (sourceImage.getWindow() != null) {
                WindowManager.setCurrentWindow(
                    sourceImage.getWindow()
                );
                sourceImage.getWindow().toFront();
            }

            var referenceDialog =
                new NonBlockingGenericDialog(
                    "FungiGrowthJ - Step 2 of 6: Position Agar ROI"
                );

            addStepIndicator(
                referenceDialog,
                2,
                6
            );

            var resizeMessage =
                agarReferenceResizeAllowed
                ? "This image uses a newly defined scale, so the oval may also be resized if necessary."
                : "The global/project scale is being reused, so oval SIZE IS LOCKED. Move it only.";

            referenceDialog.addMessage(
                "REPLICATE AGAR REFERENCE\n\n" +
                "The saved oval is already displayed on THIS image.\n" +
                "Inspect it before deciding what to do.\n\n" +
                "If it matches the plate, reposition it as needed.\n" +
                "If it does not match because this photograph has a different\n" +
                "scale, choose recalibration + independent agar; Batch will\n" +
                "restart THIS observation without changing the project scale.\n\n" +
                resizeMessage + "\n\n" +
                "Reference established from: " +
                (agarReferenceSourceDate == "" ? "previous observation" : agarReferenceSourceDate)
            );

            referenceDialog.addChoice(
                "Action:",
                [
                    "Use positioned replicate agar ROI",
                    "Define agar independently using current scale",
                    "Recalibrate this image and define agar independently"
                ],
                "Use positioned replicate agar ROI"
            );

            referenceDialog.setOKLabel(
                "Continue"
            );

            referenceDialog.showDialog();

            if (referenceDialog.wasCanceled()) {
                throw "Replicate agar ROI positioning canceled.";
            }

            var referenceAction =
                referenceDialog.getNextChoice();

            if (
                referenceAction ==
                "Define agar independently using current scale"
            ) {
                sourceImage.deleteRoi();
                useReplicateAgarReference = false;
                referencePlacementDone = true;
                break;
            }

            if (
                referenceAction ==
                "Recalibrate this image and define agar independently"
            ) {
                sourceImage.deleteRoi();

                return {
                    status: "RESTART_NEW_SCALE_AND_AGAR",
                    batch_item_id: fgBatchItemId,
                    single_image_version: FGJ_SingleImage.VERSION,
                    message:
                        "User determined from the agar-reference preview that this image has a different scale and requested both per-image recalibration and an independent agar ROI."
                };
            }

            var positionedRoi =
                sourceImage.getRoi();

            if (
                positionedRoi == null ||
                !(positionedRoi instanceof OvalRoi)
            ) {
                IJ.showMessage(
                    "FungiGrowthJ - Agar ROI",
                    "A valid Oval ROI must remain active on the image."
                );
                sourceImage.setRoi(referenceOval);
                continue;
            }

            var positionedBounds =
                positionedRoi.getBounds();

            var positionedCenterX =
                positionedBounds.x +
                positionedBounds.width / 2.0;

            var positionedCenterY =
                positionedBounds.y +
                positionedBounds.height / 2.0;

            var widthChanged =
                Math.abs(
                    positionedBounds.width -
                    referenceWidthPx
                ) > 1.0;

            var heightChanged =
                Math.abs(
                    positionedBounds.height -
                    referenceHeightPx
                ) > 1.0;

            agarReferenceMoved =
                Math.abs(positionedCenterX - referenceCenterX) > 1.0 ||
                Math.abs(positionedCenterY - referenceCenterY) > 1.0;

            if (
                !agarReferenceResizeAllowed &&
                (widthChanged || heightChanged)
            ) {

                // Preserve the user's new center but restore the fixed size.
                referenceOval =
                    new OvalRoi(
                        positionedCenterX - referenceWidthPx / 2.0,
                        positionedCenterY - referenceHeightPx / 2.0,
                        referenceWidthPx,
                        referenceHeightPx
                    );

                sourceImage.setRoi(
                    referenceOval
                );

                IJ.showMessage(
                    "FungiGrowthJ - Agar Size Locked",
                    "The replicate agar size is fixed because the global/project scale is being reused.\n\n" +
                    "Your new position was preserved, but the reference width and height were restored."
                );

                continue;
            }

            acceptedRoi =
                positionedRoi.clone();

            agarReferenceResized =
                widthChanged ||
                heightChanged;

            agarReferenceUsed = true;
            manuallyAdjusted =
                agarReferenceMoved ||
                agarReferenceResized;

            agarRoiSource =
                agarReferenceResized
                ? "replicate_reference_resized"
                : "replicate_reference";

            agarSelectionCompleted = true;
            referencePlacementDone = true;
        }
    }


    while (!agarSelectionCompleted) {

        // ========================================================
        // STEP 2 — REPRESENTATIVE AGAR SAMPLE
        // ========================================================

        var validSampleRoi = false;

        sourceImage.deleteRoi();

        while (!validSampleRoi) {

            if (
                sourceImage.getWindow() != null
            ) {

                WindowManager.setCurrentWindow(
                    sourceImage.getWindow()
                );

                sourceImage.getWindow()
                    .toFront();
            }

            var sampleInstructions =
                new NonBlockingGenericDialog(
                    "FungiGrowthJ - Step 2 of 6: Select Agar Sample"
                );

            var sampleHeader =
                new Panel(
                    new FlowLayout(
                        FlowLayout.LEFT,
                        5,
                        0
                    )
                );

            var sampleTitle =
                new Label(
                    "SELECT AGAR SAMPLE"
                );

            sampleTitle.setFont(
                new AwtFont(
                    "SansSerif",
                    AwtFont.BOLD,
                    15
                )
            );

            sampleTitle.setForeground(
                new AwtColor(
                    0,
                    105,
                    125
                )
            );

            sampleHeader.add(
                sampleTitle
            );

            sampleInstructions.addPanel(
                sampleHeader
            );

            addStepIndicator(
                sampleInstructions,
                2,
                6


            );



            sampleInstructions.addMessage(
                
                "Select a small area that represents clean agar in this image.\n\n" +
                "GOOD SAMPLE\n" +
                "• Clean agar with representative illumination\n" +
                "• Small rectangular or oval ROI\n\n" +
                "AVOID\n" +
                "• Colonies or mycelium\n" +
                "• Marker strokes\n" +
                "• Bubbles and strong reflections\n\n" +
                "FungiGrowthJ uses this sample to estimate agar color.\n" +
                "If detection is poor, you can return and choose another sample.\n\n" +
                "Draw the ROI on the image, then press Next."
            );

            sampleInstructions.setOKLabel(
                "Next"
            );

            sampleInstructions.showDialog();

            if (
                sampleInstructions.wasCanceled()
            ) {

                throw "Agar sample selection canceled.";
            }

            sampleRoi =
                sourceImage.getRoi();

            if (
                sampleRoi !== null &&
                !sampleRoi.isLine()
            ) {

                validSampleRoi =
                    true;

                break;
            }

            var retrySampleDialog =
                new GenericDialog(
                    "FungiGrowthJ - Agar Sample Missing"
                );

            addStepIndicator(
                retrySampleDialog,
                2,
                6


            );



            retrySampleDialog.addMessage(
                
                "No valid agar sample was detected.\n\n" +
                "Draw a small rectangular or oval selection over clean agar.\n" +
                "A point or line cannot be used for this step."
            );

            retrySampleDialog.setOKLabel(
                "Try again"
            );

            retrySampleDialog.showDialog();

            if (
                retrySampleDialog.wasCanceled()
            ) {

                throw "Agar sample selection canceled.";
            }
        }


        // ========================================================
        // STEP 3 — INTERACTIVE AGAR DETECTION
        // ========================================================

        var width =
            sourceImage.getWidth();

        var height =
            sourceImage.getHeight();

        var sourceProcessor =
            sourceImage.getProcessor();

        if (
            !(sourceProcessor instanceof ColorProcessor)
        ) {

            IJ.showMessage(
                "FungiGrowthJ",
                "The active image does not contain an RGB ColorProcessor."
            );

            throw "Invalid RGB processor.";
        }

        var colorProcessor =
            sourceProcessor.duplicate();

        var sampleColor =
            calculateSampleColor(
                colorProcessor,
                sampleRoi,
                width,
                height
            );

        if (
            sampleColor === null
        ) {

            var invalidSampleDialog =
                new GenericDialog(
                    "FungiGrowthJ - Invalid Agar Sample"
                );

            invalidSampleDialog.addMessage(
                "The selected agar sample contains no valid pixels.\n\n" +
                "Choose another representative area of clean agar."
            );

            invalidSampleDialog.setOKLabel(
                "Reselect agar sample"
            );

            invalidSampleDialog.showDialog();

            sourceImage.deleteRoi();
            continue;
        }

        var sampleBounds =
            sampleRoi.getBounds();

        var sampleCenterX =
            sampleBounds.x +
            sampleBounds.width /
            2.0;

        var sampleCenterY =
            sampleBounds.y +
            sampleBounds.height /
            2.0;


        // --------------------------------------------------------
        // Persistent binary-mask preview
        // --------------------------------------------------------

        var maskImage =
            new ImagePlus(
                sourceImage.getShortTitle() +
                "_interactive_agar_mask",
                new ByteProcessor(
                    width,
                    height
                )
            );

        maskImage.show();

        acceptedRoi =
            null;


        // --------------------------------------------------------
        // Live preview updater
        // --------------------------------------------------------

        function updatePreview(
            tolerance,
            medianRadius,
            closingIterations,
            openingIterations,
            circleOffsetPercent
        ) {

            var maskProcessor =
                buildColorMask(
                    colorProcessor,
                    width,
                    height,
                    sampleColor,
                    tolerance
                );

            var temporaryMask =
                new ImagePlus(
                    "temporary_agar_mask",
                    maskProcessor
                );

            if (
                medianRadius > 0
            ) {

                IJ.run(
                    temporaryMask,
                    "Median...",
                    "radius=" +
                    medianRadius
                );
            }

            for (
                var closeIndex = 0;
                closeIndex <
                closingIterations;
                closeIndex++
            ) {

                IJ.run(
                    temporaryMask,
                    "Close-",
                    ""
                );
            }

            for (
                var openIndex = 0;
                openIndex <
                openingIterations;
                openIndex++
            ) {

                IJ.run(
                    temporaryMask,
                    "Open",
                    ""
                );
            }

            IJ.run(
                temporaryMask,
                "Fill Holes",
                ""
            );

            var processedMask =
                temporaryMask.getProcessor();

            maskImage.setProcessor(
                processedMask.duplicate()
            );

            maskImage.updateAndDraw();

            var seed =
                findNearestWhitePixel(
                    processedMask,
                    sampleCenterX,
                    sampleCenterY,
                    200
                );

            if (
                seed === null
            ) {

                sourceImage.deleteRoi();

                acceptedRoi =
                    null;

                return false;
            }

            var regionRoi =
                traceSeededRegion(
                    processedMask,
                    seed.x,
                    seed.y
                );

            if (
                regionRoi === null
            ) {

                sourceImage.deleteRoi();

                acceptedRoi =
                    null;

                return false;
            }

            maskImage.setRoi(
                regionRoi
            );

            var circleRoi =
                fitCircleFromRegion(
                    sourceImage,
                    regionRoi,
                    circleOffsetPercent
                );

            if (
                circleRoi === null
            ) {

                sourceImage.setRoi(
                    regionRoi
                );

                acceptedRoi =
                    null;

                return false;
            }

            sourceImage.setRoi(
                circleRoi
            );

            if (
                sourceImage.getWindow() != null
            ) {

                sourceImage
                    .getWindow()
                    .toFront();
            }

            acceptedRoi =
                circleRoi;

            return true;
        }


        // --------------------------------------------------------
        // Interactive dialog
        // --------------------------------------------------------

        // ========================================================
        // SIMPLE AGAR ADJUSTMENT
        // ========================================================
        //
        // Most images only need RGB color tolerance. Morphological
        // settings remain available under Advanced settings, but are
        // intentionally hidden from the normal workflow.
        // ========================================================

        var finalTolerance = 65;
        var finalMedianRadius = 3;
        var finalClosingIterations = 8;
        var finalOpeningIterations = 1;
        var finalCircleOffsetPercent = 0;
        var finalLivePreview = true;

        var agarDialog =
            new GenericDialog(
                "FungiGrowthJ - Step 3 of 6: Adjust Agar ROI"
            );

        addStepIndicator(
            agarDialog,
            3,
            6


        );



        agarDialog.addMessage(
            
            "Sampled agar color:\n" +
            "R = " +
            sampleColor.meanR.toFixed(1) +
            "   G = " +
            sampleColor.meanG.toFixed(1) +
            "   B = " +
            sampleColor.meanB.toFixed(1) +
            "\n\nIn most images, RGB color tolerance is the only control\n" +
            "you should need to adjust.\n\n" +
            "If the ROI is still poor, reselect the agar sample rather\n" +
            "than forcing multiple parameters. If automatic detection is\n" +
            "not useful, draw the agar ROI manually."
        );

        agarDialog.addSlider(
            "RGB color tolerance:",
            5,
            180,
            65
        );

        agarDialog.addCheckbox(
            "Live preview",
            true
        );

        agarDialog.addChoice(
            "Next action:",
            [
                "Use these settings",
                "Advanced settings",
                "Reselect agar sample",
                "Draw agar ROI manually"
            ],
            "Use these settings"
        );

        var SimpleAgarDialogListener =
            Java.extend(
                DialogListener,
                {
                    dialogItemChanged:
                        function(gd, event) {

                            gd.resetCounters();

                            var tolerance =
                                gd.getNextNumber();

                            var livePreview =
                                gd.getNextBoolean();

                            // Consume choice to keep GenericDialog counters
                            // aligned; action is handled after closing.
                            var nextAction =
                                gd.getNextChoice();

                            if (
                                !livePreview
                            ) {
                                return true;
                            }

                            updatePreview(
                                tolerance,
                                3,
                                8,
                                1,
                                0
                            );

                            return true;
                        }
                }
            );

        agarDialog.addDialogListener(
            new SimpleAgarDialogListener()
        );

        updatePreview(
            65,
            3,
            8,
            1,
            0
        );

        agarDialog.showDialog();

        if (
            agarDialog.wasCanceled()
        ) {

            sourceImage.deleteRoi();

            if (
                maskImage.getWindow() !== null
            ) {

                maskImage.changes =
                    false;

                maskImage.close();
            }

            throw "Interactive agar detection canceled.";
        }

        agarDialog.resetCounters();

        finalTolerance =
            agarDialog.getNextNumber();

        finalLivePreview =
            agarDialog.getNextBoolean();

        var simpleAgarAction =
            agarDialog.getNextChoice();


        // --------------------------------------------------------
        // Direct exits from the simple interface
        // --------------------------------------------------------

        if (
            simpleAgarAction ==
            "Reselect agar sample"
        ) {

            if (
                maskImage.getWindow() !== null
            ) {

                maskImage.changes =
                    false;

                maskImage.close();
            }

            sourceImage.deleteRoi();
            acceptedRoi = null;
            continue;
        }

        if (
            simpleAgarAction ==
            "Draw agar ROI manually"
        ) {

            if (
                maskImage.getWindow() !== null
            ) {

                maskImage.changes =
                    false;

                maskImage.close();
            }

            var manualAgarFromSimple =
                captureManualAgarRoi();

            if (
                manualAgarFromSimple == null
            ) {

                acceptedRoi = null;
                continue;
            }

            acceptedRoi =
                manualAgarFromSimple;

            sourceImage.setRoi(
                acceptedRoi
            );

            manuallyAdjusted = true;
            agarRoiSource = "manual";
            agarSelectionCompleted = true;
            continue;
        }


        // --------------------------------------------------------
        // Advanced settings — optional
        // --------------------------------------------------------

        if (
            simpleAgarAction ==
            "Advanced settings"
        ) {

            var advancedDialog =
                new GenericDialog(
                    "FungiGrowthJ - Advanced Agar Settings"
                );

            addStepIndicator(
                advancedDialog,
                3,
                6


            );



            advancedDialog.addMessage(
                
                "These controls modify the binary agar mask.\n\n" +
                "Use them only when a good agar sample plus RGB tolerance\n" +
                "is not sufficient. Extreme values usually indicate that\n" +
                "reselecting the agar sample or drawing the ROI manually\n" +
                "would be more appropriate.\n\n" +
                "Closing fills small gaps / joins nearby mask regions.\n" +
                "Opening removes small isolated mask regions."
            );

            advancedDialog.addSlider(
                "RGB color tolerance:",
                5,
                180,
                finalTolerance
            );

            advancedDialog.addSlider(
                "Median radius:",
                0,
                10,
                3
            );

            advancedDialog.addSlider(
                "Closing iterations:",
                0,
                25,
                8
            );

            advancedDialog.addSlider(
                "Opening iterations:",
                0,
                10,
                1
            );

            advancedDialog.addSlider(
                "Circle offset (%):",
                -8,
                8,
                0
            );

            advancedDialog.addCheckbox(
                "Live preview",
                finalLivePreview
            );

            advancedDialog.addChoice(
                "Next action:",
                [
                    "Use these settings",
                    "Reselect agar sample",
                    "Draw agar ROI manually"
                ],
                "Use these settings"
            );

            var AdvancedAgarDialogListener =
                Java.extend(
                    DialogListener,
                    {
                        dialogItemChanged:
                            function(gd, event) {

                                gd.resetCounters();

                                var tolerance =
                                    gd.getNextNumber();

                                var medianRadius =
                                    Math.round(
                                        gd.getNextNumber()
                                    );

                                var closingIterations =
                                    Math.round(
                                        gd.getNextNumber()
                                    );

                                var openingIterations =
                                    Math.round(
                                        gd.getNextNumber()
                                    );

                                var circleOffsetPercent =
                                    gd.getNextNumber();

                                var livePreview =
                                    gd.getNextBoolean();

                                // Consume action choice.
                                var nextAction =
                                    gd.getNextChoice();

                                if (
                                    !livePreview
                                ) {
                                    return true;
                                }

                                updatePreview(
                                    tolerance,
                                    medianRadius,
                                    closingIterations,
                                    openingIterations,
                                    circleOffsetPercent
                                );

                                return true;
                            }
                    }
                );

            advancedDialog.addDialogListener(
                new AdvancedAgarDialogListener()
            );

            advancedDialog.showDialog();

            if (
                advancedDialog.wasCanceled()
            ) {

                // Canceling Advanced returns to the agar-selection loop,
                // rather than aborting the whole image.
                acceptedRoi = null;
                continue;
            }

            advancedDialog.resetCounters();

            finalTolerance =
                advancedDialog.getNextNumber();

            finalMedianRadius =
                Math.round(
                    advancedDialog.getNextNumber()
                );

            finalClosingIterations =
                Math.round(
                    advancedDialog.getNextNumber()
                );

            finalOpeningIterations =
                Math.round(
                    advancedDialog.getNextNumber()
                );

            finalCircleOffsetPercent =
                advancedDialog.getNextNumber();

            finalLivePreview =
                advancedDialog.getNextBoolean();

            var advancedAgarAction =
                advancedDialog.getNextChoice();

            if (
                advancedAgarAction ==
                "Reselect agar sample"
            ) {

                if (
                    maskImage.getWindow() !== null
                ) {

                    maskImage.changes =
                        false;

                    maskImage.close();
                }

                sourceImage.deleteRoi();
                acceptedRoi = null;
                continue;
            }

            if (
                advancedAgarAction ==
                "Draw agar ROI manually"
            ) {

                if (
                    maskImage.getWindow() !== null
                ) {

                    maskImage.changes =
                        false;

                    maskImage.close();
                }

                var manualAgarFromAdvanced =
                    captureManualAgarRoi();

                if (
                    manualAgarFromAdvanced == null
                ) {

                    acceptedRoi = null;
                    continue;
                }

                acceptedRoi =
                    manualAgarFromAdvanced;

                sourceImage.setRoi(
                    acceptedRoi
                );

                manuallyAdjusted = true;
                agarRoiSource = "manual";
                agarSelectionCompleted = true;
                continue;
            }
        }


        var finalSuccess =
            updatePreview(
                finalTolerance,
                finalMedianRadius,
                finalClosingIterations,
                finalOpeningIterations,
                finalCircleOffsetPercent
            );


        // --------------------------------------------------------
        // Detection failure: let user reselect instead of aborting
        // --------------------------------------------------------

        if (
            !finalSuccess ||
            acceptedRoi === null
        ) {

            var agarFailureDialog =
                new GenericDialog(
                    "FungiGrowthJ - Agar Detection Incomplete"
                );

            addStepIndicator(
                agarFailureDialog,
                3,
                6


            );



            agarFailureDialog.addMessage(
                
                "No valid agar ROI could be generated from this sample.\n\n" +
                "Choose another agar sample or draw the useful agar\n" +
                "boundary manually."
            );

            agarFailureDialog.addChoice(
                "Next action:",
                [
                    "Reselect agar sample",
                    "Draw agar ROI manually"
                ],
                "Reselect agar sample"
            );

            agarFailureDialog.setOKLabel(
                "Continue"
            );

            agarFailureDialog.showDialog();

            var agarFailureAction =
                agarFailureDialog.getNextChoice();

            if (
                maskImage.getWindow() !== null
            ) {

                maskImage.changes =
                    false;

                maskImage.close();
            }

            sourceImage.deleteRoi();

            if (
                agarFailureAction ==
                "Draw agar ROI manually"
            ) {

                var manualAgarAfterFailure =
                    captureManualAgarRoi();

                if (
                    manualAgarAfterFailure != null
                ) {

                    acceptedRoi =
                        manualAgarAfterFailure;

                    sourceImage.setRoi(
                        acceptedRoi
                    );

                    manuallyAdjusted = true;
                    agarRoiSource = "manual";
                    agarSelectionCompleted = true;
                }
            }

            continue;
        }


        // --------------------------------------------------------
        // Final confirmation, manual adjustment, or reselect sample
        // --------------------------------------------------------

        var confirmation =
            new NonBlockingGenericDialog(
                "FungiGrowthJ - Confirm Agar ROI"
            );

        var confirmAgarHeader =
            new Panel(
                new FlowLayout(
                    FlowLayout.LEFT,
                    5,
                    0
                )
            );

        var confirmAgarTitle =
            new Label(
                "CONFIRM AGAR ROI"
            );

        confirmAgarTitle.setFont(
            new AwtFont(
                "SansSerif",
                AwtFont.BOLD,
                15
            )
        );

        confirmAgarTitle.setForeground(
            new AwtColor(
                0,
                105,
                125
            )
        );

        confirmAgarHeader.add(
            confirmAgarTitle
        );

        confirmation.addPanel(
            confirmAgarHeader
        );

        addStepIndicator(
            confirmation,
            3,
            6


        );



        confirmation.addMessage(
            
            "Check the proposed agar boundary on the image.\n\n" +
            "CORRECT ROI\n" +
            "The selection follows the useful agar boundary — not the\n" +
            "outer glass or plastic edge.\n\n" +
            "NEEDS A SMALL CORRECTION\n" +
            "Resize or reposition the ROI directly on the image, then\n" +
            "check 'ROI was manually adjusted'.\n\n" +
            "NOT USABLE\n" +
            "Reselect the agar sample or draw the agar ROI manually."
        );

        confirmation.addChoice(
            "Decision:",
            [
                "Use this agar ROI",
                "Reselect agar sample",
                "Draw agar ROI manually"
            ],
            "Use this agar ROI"
        );

        confirmation.addCheckbox(
            "ROI was manually adjusted",
            false
        );

        confirmation.setOKLabel(
            "Continue"
        );

        confirmation.showDialog();

        if (
            confirmation.wasCanceled()
        ) {

            sourceImage.deleteRoi();

            if (
                maskImage.getWindow() !== null
            ) {

                maskImage.changes =
                    false;

                maskImage.close();
            }

            throw "Agar ROI confirmation canceled.";
        }

        var agarDecision =
            confirmation.getNextChoice();

        manuallyAdjusted =
            confirmation.getNextBoolean();

        if (
            agarDecision ==
            "Reselect agar sample"
        ) {

            if (
                maskImage.getWindow() !== null
            ) {

                maskImage.changes =
                    false;

                maskImage.close();
            }

            sourceImage.deleteRoi();

            acceptedRoi =
                null;

            continue;
        }

        if (
            agarDecision ==
            "Draw agar ROI manually"
        ) {

            if (
                maskImage.getWindow() !== null
            ) {

                maskImage.changes =
                    false;

                maskImage.close();
            }

            var manualAgarFromConfirmation =
                captureManualAgarRoi();

            if (
                manualAgarFromConfirmation == null
            ) {

                acceptedRoi = null;
                continue;
            }

            acceptedRoi =
                manualAgarFromConfirmation;

            sourceImage.setRoi(
                acceptedRoi
            );

            manuallyAdjusted = true;
            agarRoiSource = "manual";
            agarSelectionCompleted = true;
            continue;
        }

        acceptedRoi =
            sourceImage.getRoi();

        agarRoiSource =
            manuallyAdjusted
            ? "automatic_edited"
            : "automatic";

        if (
            acceptedRoi === null
        ) {

            IJ.showMessage(
                "FungiGrowthJ",
                "No ROI is currently selected."
            );

            if (
                maskImage.getWindow() !== null
            ) {

                maskImage.changes =
                    false;

                maskImage.close();
            }

            sourceImage.deleteRoi();

            continue;
        }

        if (
            maskImage.getWindow() !== null
        ) {

            maskImage.changes =
                false;

            maskImage.close();
        }

        agarSelectionCompleted =
            true;
    }


    // If no replicate reference existed, a successfully confirmed agar oval
    // becomes the reference when replicate reuse is requested. In ASK mode,
    // the first independently defined oval also seeds the optional reference
    // for later dates.
    if (
        fgAgarReference == null &&
        (fgAgarRoiPolicy == "REUSE_REPLICATE" ||
         fgAgarRoiPolicy == "ASK") &&
        acceptedRoi != null
    ) {
        agarReferenceEstablished = true;
        agarReferenceShouldPersist = true;
        agarReferenceSourceDate = fgDateIso;
    }


    // ============================================================
    // FINAL REPORT
    // ============================================================

    // The final summary is deliberately reversible when a replicate agar
    // reference is in use. This prevents an accidental click on Next from
    // committing a misplaced reference oval: the user can return, reposition
    // it, and then review the summary again before colony detection begins.
    var agarReadyConfirmed = false;

    while (!agarReadyConfirmed) {

        var acceptedBounds =
            acceptedRoi.getBounds();

        var acceptedCenterX =
            acceptedBounds.x +
            acceptedBounds.width / 2.0;

        var acceptedCenterY =
            acceptedBounds.y +
            acceptedBounds.height / 2.0;

        var acceptedRadiusX =
            acceptedBounds.width / 2.0;

        var acceptedRadiusY =
            acceptedBounds.height / 2.0;


        // Convert accepted radius to calibrated units.
        // Defensive fallback: sourceImage calibration is the canonical
        // truth if a future execution path does not assign the local object.
        if (calibration == null) {
            calibration =
                sourceImage.getCalibration();
        }

        if (
            calibration == null ||
            !isFinite(
                calibration.pixelWidth
            ) ||
            calibration.pixelWidth <= 0
        ) {
            throw new Error(
                "VALID_CALIBRATION_MISSING_AFTER_AGAR_CONFIRMATION"
            );
        }

        var radiusXUnits =
            acceptedRadiusX *
            calibration.pixelWidth;

        var radiusYUnits =
            acceptedRadiusY *
            calibration.pixelHeight;

        var readyDialog =
            new GenericDialog(
                "FungiGrowthJ - Calibration and Agar Detection Completed"
            );

        var readyHeader =
            new Panel(
                new FlowLayout(FlowLayout.LEFT, 5, 0)
            );

        var readyTitle =
            new Label("IMAGE READY FOR COLONY ANALYSIS");

        readyTitle.setFont(
            new AwtFont("SansSerif", AwtFont.BOLD, 15)
        );

        readyTitle.setForeground(
            new AwtColor(0, 120, 70)
        );

        readyHeader.add(readyTitle);
        readyDialog.addPanel(readyHeader);

        readyDialog.addMessage(
            "Calibration and agar definition are complete.\n\n" +
            "SCALE\n" +
            "Known distance: " + knownDistance.toFixed(2) + " " + scaleUnit + "\n" +
            "Line length: " + lineLengthPixels.toFixed(2) + " px\n" +
            "Pixels per " + scaleUnit + ": " + pixelsPerUnit.toFixed(4) + "\n\n" +
            "AGAR ROI\n" +
            "Center: X " + acceptedCenterX.toFixed(2) +
            " px  |  Y " + acceptedCenterY.toFixed(2) + " px\n" +
            "Radius X: " + acceptedRadiusX.toFixed(2) + " px (" +
            radiusXUnits.toFixed(2) + " " + scaleUnit + ")\n" +
            "Radius Y: " + acceptedRadiusY.toFixed(2) + " px (" +
            radiusYUnits.toFixed(2) + " " + scaleUnit + ")\n\n" +
            "TRACEABILITY\n" +
            "Scale: drawn known distance\n" +
            "Agar ROI: " +
            (agarRoiSource == "manual" ? "manual oval" :
             agarRoiSource == "automatic_edited" ? "automatic + manual adjustment" :
             agarRoiSource == "replicate_reference" ? "replicate reference oval" :
             agarRoiSource == "replicate_reference_resized" ? "replicate reference oval + permitted resize" :
             "automatic") +
            "\n" +
            "Apply scale to project: " + applyScaleToProject +
            (agarReferenceUsed
             ? "\n\nIf the replicate agar oval is not correctly positioned, use the Back button below."
             : "")
        );

        readyDialog.setOKLabel("Continue to colony detection");

        if (agarReferenceUsed) {
            readyDialog.setCancelLabel(
                "Back: reposition agar ROI"
            );
        }

        readyDialog.showDialog();

        if (!readyDialog.wasCanceled()) {
            agarReadyConfirmed = true;
            break;
        }

        // The Back button is intentionally available only for a reused
        // replicate reference. Independent agar detection retains its normal
        // cancellation behavior because returning to its earlier sample/mask
        // workflow requires a different state transition.
        if (!agarReferenceUsed) {
            throw "Calibration / agar confirmation canceled.";
        }

        // Restore the accepted oval on the source image and let the user
        // reposition it again. The same size-locking rule used in the initial
        // reference placement is applied here.
        var backPlacementDone = false;

        while (!backPlacementDone) {

            if (sourceImage.getWindow() != null) {
                WindowManager.setCurrentWindow(
                    sourceImage.getWindow()
                );
                sourceImage.getWindow().toFront();
            }

            sourceImage.setRoi(
                acceptedRoi.clone()
            );

            var backDialog =
                new NonBlockingGenericDialog(
                    "FungiGrowthJ - Reposition Agar ROI"
                );

            addStepIndicator(
                backDialog,
                2,
                6
            );

            var backResizeMessage =
                agarReferenceResizeAllowed
                ? "This image uses a newly defined scale, so the oval may also be resized if necessary."
                : "The global/project scale is being reused, so oval SIZE IS LOCKED. Move it only.";

            backDialog.addMessage(
                "REPOSITION REPLICATE AGAR REFERENCE\n\n" +
                "Move the oval so it matches the useful agar boundary.\n\n" +
                backResizeMessage + "\n\n" +
                "Press Use positioned agar ROI when it is correct."
            );

            backDialog.setOKLabel(
                "Use positioned agar ROI"
            );

            backDialog.showDialog();

            if (backDialog.wasCanceled()) {
                // Cancel here returns to the summary without changing the
                // previously accepted agar ROI.
                sourceImage.setRoi(
                    acceptedRoi
                );
                backPlacementDone = true;
                break;
            }

            var backPositionedRoi =
                sourceImage.getRoi();

            if (
                backPositionedRoi == null ||
                !(backPositionedRoi instanceof OvalRoi)
            ) {
                IJ.showMessage(
                    "FungiGrowthJ - Agar ROI",
                    "A valid Oval ROI must remain active on the image."
                );
                sourceImage.setRoi(
                    acceptedRoi
                );
                continue;
            }

            var backPositionedBounds =
                backPositionedRoi.getBounds();

            var backCenterX =
                backPositionedBounds.x +
                backPositionedBounds.width / 2.0;

            var backCenterY =
                backPositionedBounds.y +
                backPositionedBounds.height / 2.0;

            var backWidthChanged =
                Math.abs(
                    backPositionedBounds.width -
                    referenceWidthPx
                ) > 1.0;

            var backHeightChanged =
                Math.abs(
                    backPositionedBounds.height -
                    referenceHeightPx
                ) > 1.0;

            if (
                !agarReferenceResizeAllowed &&
                (backWidthChanged || backHeightChanged)
            ) {
                // Keep the corrected center but restore the fixed replicate
                // dimensions before accepting the repositioned oval.
                acceptedRoi =
                    new OvalRoi(
                        backCenterX - referenceWidthPx / 2.0,
                        backCenterY - referenceHeightPx / 2.0,
                        referenceWidthPx,
                        referenceHeightPx
                    );

                sourceImage.setRoi(
                    acceptedRoi
                );

                IJ.showMessage(
                    "FungiGrowthJ - Agar Size Locked",
                    "The replicate agar size is fixed because the global/project scale is being reused.\n\n" +
                    "Your new position was preserved, but the reference width and height were restored."
                );

                agarReferenceMoved = true;
                manuallyAdjusted = true;
                agarRoiSource = "replicate_reference";
                backPlacementDone = true;
                break;
            }

            acceptedRoi =
                backPositionedRoi.clone();

            agarReferenceMoved = true;
            agarReferenceResized =
                backWidthChanged ||
                backHeightChanged;

            manuallyAdjusted = true;

            agarRoiSource =
                agarReferenceResized
                ? "replicate_reference_resized"
                : "replicate_reference";

            backPlacementDone = true;
        }
    }

    // ============================================================
    // OPTIONAL SPATIAL REFERENCE — INOCULATION ORIGIN
    // ============================================================

    var inoculationOriginXpx =
        NaN;

    var inoculationOriginYpx =
        NaN;

    var inoculationOriginRecorded =
        false;

    if (fgRecordInoculationOrigin) {

        var validInoculationPoint =
            false;

        while (!validInoculationPoint) {

            if (
                sourceImage.getWindow() != null
            ) {

                WindowManager.setCurrentWindow(
                    sourceImage.getWindow()
                );

                sourceImage
                    .getWindow()
                    .toFront();
            }

            // Remove the agar ROI from active selection before asking
            // for a point. The accepted agar geometry is already stored
            // in acceptedRoi / acceptedBounds.
            sourceImage.deleteRoi();

            var inoculationDialog =
                new NonBlockingGenericDialog(
                    "FungiGrowthJ - Mark Inoculation Origin"
                );

            inoculationDialog.addMessage(
                "Record the inoculation origin for THIS image.\n\n" +
                "1. Select Fiji's Point Tool.\n" +
                "2. Click once on the original inoculation point.\n" +
                "3. Press Next.\n\n" +
                "This point will be used as the spatial origin for\n" +
                "satellite-dispersal measurements in this photograph.\n\n" +
                "Do not use the geometrical center of the plate unless\n" +
                "that is truly where the inoculum was placed."
            );

            inoculationDialog.setOKLabel(
                "Next"
            );

            inoculationDialog.showDialog();

            if (
                inoculationDialog.wasCanceled()
            ) {

                throw "Inoculation-origin recording canceled.";
            }

            var pointRoi =
                sourceImage.getRoi();

            if (
                pointRoi != null &&
                pointRoi instanceof PointRoi
            ) {

                var pointPolygon =
                    pointRoi.getFloatPolygon();

                if (
                    pointPolygon != null &&
                    pointPolygon.npoints >= 1
                ) {

                    inoculationOriginXpx =
                        pointPolygon.xpoints[0];

                    inoculationOriginYpx =
                        pointPolygon.ypoints[0];

                    inoculationOriginRecorded =
                        true;

                    validInoculationPoint =
                        true;

                    break;
                }
            }

            var retryInoculation =
                new GenericDialog(
                    "FungiGrowthJ - Inoculation Point Missing"
                );

            retryInoculation.addMessage(
                "No valid single point was detected on the source image.\n\n" +
                "Use Fiji's Point Tool, click once on the inoculation\n" +
                "origin, and press Try again."
            );

            retryInoculation.setOKLabel(
                "Try again"
            );

            retryInoculation.showDialog();

            if (
                retryInoculation.wasCanceled()
            ) {

                throw "Inoculation-origin recording canceled.";
            }
        }

        sourceImage.deleteRoi();

        var originCalibration =
            sourceImage.getCalibration();

        var originXUnits =
            inoculationOriginXpx *
            originCalibration.pixelWidth;

        var originYUnits =
            inoculationOriginYpx *
            originCalibration.pixelHeight;

        IJ.showMessage(
            "FungiGrowthJ - Inoculation Origin Recorded",
            "Inoculation origin saved for this image.\n\n" +
            "X: " +
            originXUnits.toFixed(3) +
            " " +
            scaleUnit +
            "\n" +
            "Y: " +
            originYUnits.toFixed(3) +
            " " +
            scaleUnit +
            "\n\n" +
            "The point will be used to calculate distances from\n" +
            "confirmed colonies to the inoculation origin."
        );
    }


    // ------------------------------------------------------------
    // ROI persistence helper
    // ------------------------------------------------------------
    // Saves an explicit set of ROIs as an ImageJ ROI Manager ZIP.
    // The active review manager is rebuilt after saving, so this helper
    // is used only at stable workflow checkpoints.

    function saveRoiZip(pathValue, roiItems, nameItems) {

        if (pathValue == null || String(pathValue) == "") {
            return "";
        }

        var FileClass = Java.type("java.io.File");
        var target = new FileClass(String(pathValue));
        var parent = target.getParentFile();

        if (parent != null && !parent.exists()) {
            if (!parent.mkdirs() && !parent.exists()) {
                throw new Error(
                    "Could not create ROI persistence folder:\n" +
                    parent.getAbsolutePath()
                );
            }
        }

        // Use a dedicated HIDDEN ROI Manager for persistence.
        //
        // Do not reuse/reset the visible review manager here. In Fiji builds
        // using FlatLaf, clearing and repopulating the visible JList while the
        // AWT event thread is painting it can raise intermittent
        // ArrayIndexOutOfBoundsException errors in FlatListUI.paintCell().
        // The hidden manager isolates file I/O from the interactive review UI.
        var manager = new RoiManager(true);

        try {
            for (var sr = 0; sr < roiItems.length; sr++) {
                if (roiItems[sr] == null) continue;

                var storedRoi;
                try {
                    storedRoi = roiItems[sr].clone();
                } catch (storedCloneError) {
                    storedRoi = roiItems[sr];
                }

                manager.addRoi(storedRoi);

                if (nameItems != null && sr < nameItems.length) {
                    manager.rename(manager.getCount() - 1, String(nameItems[sr]));
                }
            }

            if (manager.getCount() <= 0) {
                return "";
            }

            manager.runCommand("Save", target.getAbsolutePath());

            if (!target.exists() || target.length() <= 0) {
                throw new Error(
                    "ROI ZIP was not created or is empty:\n" +
                    target.getAbsolutePath()
                );
            }

            return String(target.getAbsolutePath());

        } finally {
            try {
                manager.close();
            } catch (hiddenManagerCloseError) {
                // Persistence already completed; do not fail the analysis
                // because a hidden helper manager could not be disposed.
            }
        }
    }

    // ============================================================
    // COLONY DETECTION, REVIEW AND MEASUREMENT
    // ============================================================

    importClass(Packages.ij.IJ);
    importClass(Packages.ij.ImagePlus);
    importClass(Packages.ij.WindowManager);
    importClass(Packages.ij.gui.GenericDialog);
    importClass(Packages.ij.gui.NonBlockingGenericDialog);
    importClass(Packages.ij.gui.Overlay);
    importClass(Packages.ij.gui.TextRoi);
    importClass(Packages.ij.measure.Measurements);
    importClass(Packages.ij.measure.ResultsTable);
    importClass(Packages.ij.plugin.filter.Analyzer);
    importClass(Packages.ij.plugin.filter.ParticleAnalyzer);
    importClass(Packages.ij.plugin.frame.RoiManager);
    importClass(Packages.ij.process.AutoThresholder);
    importClass(Packages.ij.process.ByteProcessor);
    importClass(Packages.ij.process.ColorProcessor);
    importClass(Packages.java.awt.Font);
    importClass(Packages.java.lang.Byte);
    importClass(Packages.java.lang.Integer);
    importClass(Packages.java.lang.reflect.Array);


    // ------------------------------------------------------------
    // DEDICATED PARTICLE ANALYSIS
    // ------------------------------------------------------------
    //
    // Analyze Particles is routed to a fresh hidden manager for each pass.
    // The visible interactive ROI Manager is populated only after the ROIs
    // for the current image have been collected.
    //
    function analyzeParticlesToRois(
        image,
        minSize,
        maxSize,
        excludeEdgeObjects
    ) {

        var analysisManager =
            new RoiManager(true);

        var options =
            ParticleAnalyzer.SHOW_NONE |
            ParticleAnalyzer.ADD_TO_MANAGER;

        if (excludeEdgeObjects) {
            options =
                options |
                ParticleAnalyzer.EXCLUDE_EDGE_PARTICLES;
        }

        var particleResults =
            new ResultsTable();

        try {

            ParticleAnalyzer.setRoiManager(
                analysisManager
            );

            var particleAnalyzer =
                new ParticleAnalyzer(
                    options,
                    0,
                    particleResults,
                    minSize,
                    maxSize,
                    0.0,
                    1.0
                );

            if (
                !particleAnalyzer.analyze(
                    image
                )
            ) {
                throw new Error(
                    "ParticleAnalyzer could not analyze the current image."
                );
            }

            var outputRois = [];

            for (
                var roiIndex = 0;
                roiIndex < analysisManager.getCount();
                roiIndex++
            ) {
                var detectedRoi =
                    analysisManager.getRoi(
                        roiIndex
                    );

                if (detectedRoi != null) {
                    outputRois.push(
                        detectedRoi.clone()
                    );
                }
            }

            return outputRois;

        } finally {

            try {
                analysisManager.reset();
                analysisManager.close();
            } catch (managerCloseError) {}

            try {
                ParticleAnalyzer.setRoiManager(null);
            } catch (clearManagerError) {}
        }
    }


    // ------------------------------------------------------------
    // BORDER-ARTIFACT FILTER
    // ------------------------------------------------------------
    //
    // Automatic illumination correction makes broad intensity gradients
    // less influential, but it can also reveal dark structures associated
    // with the Petri-dish perimeter, glass reflections, or edge marks.
    // These structures can therefore appear as connected particle candidates.
    //
    // The filter is deliberately morphology-aware. A candidate is considered
    // a strong border artifact only when its contour contacts a narrow band
    // around the useful agar edge AND its shape is strongly artifact-like
    // (elongated, very low circularity, or low solidity).
    //
    // The previous version also required the centroid to be near the border.
    // That was too restrictive for long arc-shaped artifacts: their centroids
    // can lie well inside the plate even though the object itself follows the
    // perimeter. This version removes that centroid requirement while keeping
    // compact edge-reaching colonies protected by the morphology test.
    //
    // Filtered candidates are removed from the interactive review queue, but
    // the count and method are retained in the exported metadata for audit.
    // ------------------------------------------------------------

    var FGJ_BORDER_FILTER_VERSION =
        "BORDER_ARTIFACT_FILTER_v2";

    var FGJ_BORDER_CONTACT_FRACTION = 0.04;
    var FGJ_BORDER_CONTACT_MIN_PX = 5.0;
    var FGJ_BORDER_CONTACT_MAX_PX = 18.0;

    // A true colony may reach the plate edge, so the filter must not rely
    // on edge contact alone. However, a long, narrow, low-circularity or
    // low-solidity object that follows the perimeter is strongly indicative
    // of a glass/plastic/reflection artifact.
    var FGJ_BORDER_ASPECT_MIN = 2.5;
    var FGJ_BORDER_CIRCULARITY_MAX = 0.25;
    var FGJ_BORDER_SOLIDITY_MAX = 0.55;

    function getAgarGeometry(agarRoi) {
        if (agarRoi == null) return null;

        var bounds = agarRoi.getBounds();
        if (bounds == null) return null;

        var centerX = bounds.x + bounds.width / 2.0;
        var centerY = bounds.y + bounds.height / 2.0;
        var radiusX = bounds.width / 2.0;
        var radiusY = bounds.height / 2.0;

        if (radiusX <= 0 || radiusY <= 0) return null;

        return {
            centerX: centerX,
            centerY: centerY,
            radiusX: radiusX,
            radiusY: radiusY,
            minimumRadius: Math.min(radiusX, radiusY)
        };
    }

    function normalizedRadiusFromAgarCenter(
        x,
        y,
        agarGeometry
    ) {
        var dx =
            (x - agarGeometry.centerX) /
            agarGeometry.radiusX;

        var dy =
            (y - agarGeometry.centerY) /
            agarGeometry.radiusY;

        return Math.sqrt(dx * dx + dy * dy);
    }

    function borderContactDistancePx(roi, agarGeometry) {
        if (roi == null || agarGeometry == null) {
            return Number.POSITIVE_INFINITY;
        }

        var polygon = null;

        try {
            polygon = roi.getFloatPolygon();
        } catch (polygonError) {
            polygon = null;
        }

        if (polygon == null || polygon.npoints <= 0) {
            return Number.POSITIVE_INFINITY;
        }

        var minimumMarginPx = Number.POSITIVE_INFINITY;

        for (var pi = 0; pi < polygon.npoints; pi++) {
            var px = polygon.xpoints[pi];
            var py = polygon.ypoints[pi];

            var normalizedRadius =
                normalizedRadiusFromAgarCenter(
                    px,
                    py,
                    agarGeometry
                );

            var marginPx =
                Math.max(
                    0,
                    (1.0 - normalizedRadius) *
                    agarGeometry.minimumRadius
                );

            if (marginPx < minimumMarginPx) {
                minimumMarginPx = marginPx;
            }
        }

        return minimumMarginPx;
    }

    function isStrongBorderArtifact(
        roi,
        values,
        agarGeometry
    ) {
        if (roi == null || values == null || agarGeometry == null) {
            return false;
        }

        var contactBandPx = Math.max(
            FGJ_BORDER_CONTACT_MIN_PX,
            Math.min(
                FGJ_BORDER_CONTACT_MAX_PX,
                agarGeometry.minimumRadius *
                FGJ_BORDER_CONTACT_FRACTION
            )
        );

        if (
            borderContactDistancePx(
                roi,
                agarGeometry
            ) > contactBandPx
        ) {
            return false;
        }

        var elongated =
            values.aspect_ratio >= FGJ_BORDER_ASPECT_MIN;

        var veryLowCircularity =
            values.circularity <= FGJ_BORDER_CIRCULARITY_MAX;

        var nonSolid =
            !isNaN(values.solidity) &&
            values.solidity <= FGJ_BORDER_SOLIDITY_MAX;

        return elongated ||
               veryLowCircularity ||
               nonSolid;
    }

    function measureRoi(image, roi, centerX, centerY) {

        // Measurements used as pixel fields must be calculated with
        // an explicitly uncalibrated image. Otherwise ImageJ returns
        // physical units while the columns are incorrectly labeled px.
        var savedCalibration =
            image.getCalibration().copy();

        var pixelCalibration =
            new Calibration();

        pixelCalibration.pixelWidth = 1.0;
        pixelCalibration.pixelHeight = 1.0;
        pixelCalibration.pixelDepth = 1.0;
        pixelCalibration.setUnit("pixel");

        image.setCalibration(
            pixelCalibration
        );

        try {

            var table =
                new ResultsTable();

            var flags =
                Measurements.AREA |
                Measurements.PERIMETER |
                Measurements.CENTROID |
                Measurements.SHAPE_DESCRIPTORS |
                Measurements.RECT |
                Measurements.ELLIPSE |
                Measurements.FERET;

            var analyzer =
                new Analyzer(
                    image,
                    flags,
                    table
                );

            image.setRoi(roi);
            analyzer.measure();

            var row =
                table.size() - 1;

            var x =
                table.getValue(
                    "X",
                    row
                );

            var y =
                table.getValue(
                    "Y",
                    row
                );

            var dx =
                x - centerX;

            var dy =
                y - centerY;

            var areaPx2 =
                table.getValue(
                    "Area",
                    row
                );

            var perimeterPx =
                table.getValue(
                    "Perim.",
                    row
                );

            var majorAxisPx =
                table.getValue(
                    "Major",
                    row
                );

            var minorAxisPx =
                table.getValue(
                    "Minor",
                    row
                );

            var ellipseAngleDeg =
                table.getValue(
                    "Angle",
                    row
                );

            var feretMaxPx =
                table.getValue(
                    "Feret",
                    row
                );

            var feretMinPx =
                table.getValue(
                    "MinFeret",
                    row
                );

            var feretAngleDeg =
                table.getValue(
                    "FeretAngle",
                    row
                );

            // Convex hull metrics are measured from the same ROI in
            // uncalibrated pixel space.
            var convexHullAreaPx2 =
                NaN;

            var convexHullPerimeterPx =
                NaN;

            try {

                var hullPolygon =
                    roi.getConvexHull();

                if (
                    hullPolygon != null &&
                    hullPolygon.npoints >= 3
                ) {

                    var hullRoi =
                        new PolygonRoi(
                            hullPolygon,
                            Roi.POLYGON
                        );

                    var hullTable =
                        new ResultsTable();

                    var hullAnalyzer =
                        new Analyzer(
                            image,
                            Measurements.AREA |
                            Measurements.PERIMETER,
                            hullTable
                        );

                    image.setRoi(
                        hullRoi
                    );

                    hullAnalyzer.measure();

                    var hullRow =
                        hullTable.size() - 1;

                    convexHullAreaPx2 =
                        hullTable.getValue(
                            "Area",
                            hullRow
                        );

                    convexHullPerimeterPx =
                        hullTable.getValue(
                            "Perim.",
                            hullRow
                        );
                }

            } catch (hullError) {

                convexHullAreaPx2 =
                    NaN;

                convexHullPerimeterPx =
                    NaN;
            }

            // Restore the original ROI after convex-hull measurement.
            image.setRoi(
                roi
            );

            var aspectRatio =
                (
                    isFinite(majorAxisPx) &&
                    isFinite(minorAxisPx) &&
                    minorAxisPx > 0
                )
                ? majorAxisPx /
                  minorAxisPx
                : NaN;

            var eccentricity =
                (
                    isFinite(majorAxisPx) &&
                    isFinite(minorAxisPx) &&
                    majorAxisPx > 0 &&
                    minorAxisPx >= 0 &&
                    minorAxisPx <= majorAxisPx
                )
                ? Math.sqrt(
                    Math.max(
                        0,
                        1.0 -
                        (
                            minorAxisPx *
                            minorAxisPx
                        ) /
                        (
                            majorAxisPx *
                            majorAxisPx
                        )
                    )
                  )
                : NaN;

            var solidity =
                (
                    isFinite(convexHullAreaPx2) &&
                    convexHullAreaPx2 > 0
                )
                ? areaPx2 /
                  convexHullAreaPx2
                : NaN;

            var convexity =
                (
                    isFinite(convexHullPerimeterPx) &&
                    isFinite(perimeterPx) &&
                    perimeterPx > 0
                )
                ? convexHullPerimeterPx /
                  perimeterPx
                : NaN;

            return {
                area_px2:
                    areaPx2,

                perimeter_px:
                    perimeterPx,

                centroid_x_px:
                    x,

                centroid_y_px:
                    y,

                circularity:
                    table.getValue(
                        "Circ.",
                        row
                    ),

                distance_to_center_px:
                    Math.sqrt(
                        dx * dx +
                        dy * dy
                    ),

                major_axis_px:
                    majorAxisPx,

                minor_axis_px:
                    minorAxisPx,

                ellipse_angle_deg:
                    ellipseAngleDeg,

                feret_max_px:
                    feretMaxPx,

                feret_min_px:
                    feretMinPx,

                feret_angle_deg:
                    feretAngleDeg,

                aspect_ratio:
                    aspectRatio,

                eccentricity:
                    eccentricity,

                convex_hull_area_px2:
                    convexHullAreaPx2,

                convex_hull_perimeter_px:
                    convexHullPerimeterPx,

                solidity:
                    solidity,

                convexity:
                    convexity
            };

        } finally {

            image.setCalibration(
                savedCalibration
            );
        }
    }

    function copyMeasurements(candidate, values) {
        candidate.area_px2 = values.area_px2;
        candidate.perimeter_px = values.perimeter_px;
        candidate.centroid_x_px = values.centroid_x_px;
        candidate.centroid_y_px = values.centroid_y_px;
        candidate.circularity = values.circularity;
        candidate.distance_to_center_px = values.distance_to_center_px;

        candidate.major_axis_px = values.major_axis_px;
        candidate.minor_axis_px = values.minor_axis_px;
        candidate.ellipse_angle_deg = values.ellipse_angle_deg;

        candidate.feret_max_px = values.feret_max_px;
        candidate.feret_min_px = values.feret_min_px;
        candidate.feret_angle_deg = values.feret_angle_deg;

        candidate.aspect_ratio = values.aspect_ratio;
        candidate.eccentricity = values.eccentricity;

        candidate.convex_hull_area_px2 =
            values.convex_hull_area_px2;

        candidate.convex_hull_perimeter_px =
            values.convex_hull_perimeter_px;

        candidate.solidity = values.solidity;
        candidate.convexity = values.convexity;
    }

    // Re-bind explicitly to the Batch source image.
    // The original prototype contained a second WindowManager lookup
    // in this processing section. During Batch, a previous
    // *_guided_review window may still be active, so relying on the
    // current Fiji window can analyze the wrong image.
    sourceImage =
        fgExplicitSourceImage != null
        ? fgExplicitSourceImage
        : WindowManager.getCurrentImage();

    if (sourceImage == null) {
        IJ.showMessage("FungiGrowthJ", "Please open an RGB image first.");
        throw "No active image.";
    }

    if (sourceImage.getBitDepth() != 24) {
        IJ.showMessage("FungiGrowthJ", "The active image must be RGB.");
        throw "Image is not RGB.";
    }

    // ------------------------------------------------------------
    // RESTORE THE CONFIRMED AGAR ROI
    // ------------------------------------------------------------
    //
    // Do NOT read sourceImage.getRoi() here.
    //
    // After agar confirmation, later workflow steps may legitimately
    // replace the active Fiji selection (for example, the inoculation
    // Point ROI). The scientific agar boundary is the previously
    // confirmed acceptedRoi, which must remain the source of truth.
    //
    var agarRoi =
        acceptedRoi != null
        ? acceptedRoi
        : null;

    if (agarRoi == null) {

        IJ.showMessage(
            "FungiGrowthJ",
            "The previously confirmed agar ROI is not available.\n\n" +
            "This image cannot continue safely."
        );

        throw "Confirmed agar ROI is missing.";
    }

    // Restore it as the active ROI only for the colony-detection stage.
    sourceImage.setRoi(
        agarRoi
    );

    var settings =
        new GenericDialog(
            "FungiGrowthJ - Step 4 of 6: Detection & Review Settings"
        );

    var settingsHeader =
        new Panel(
            new FlowLayout(FlowLayout.LEFT, 5, 0)
        );

    var settingsTitle =
        new Label("DETECTION & REVIEW SETTINGS");

    settingsTitle.setFont(
        new AwtFont("SansSerif", AwtFont.BOLD, 15)
    );

    settingsTitle.setForeground(
        new AwtColor(0, 105, 125)
    );

    settingsHeader.add(settingsTitle);
    settings.addPanel(settingsHeader);

    addStepIndicator(
        settings,
        4,
        6


    );



    settings.addMessage(
        
        "DETECTION\n" +
        "The defaults are recommended for normal use.\n\n" +
        "Illumination handling is automatic: FungiGrowthJ evaluates the\n" +
        "low-frequency brightness background and applies correction only\n" +
        "when a substantial gradient is detected."
    );

    settings.addNumericField("Binary closing iterations:", 1, 0);
    settings.addNumericField("Marker gap closure iterations:", 0, 0);
    settings.addMessage(
        "Marker gap closure applies a conservative dilation before Fill Holes " +
        "to bridge short breaks in dark marker contours. Use 1-2 for testing."
    );

    settings.addCheckbox(
        "Clean dark artifacts manually before detection",
        false
    );
    settings.addNumericField(
        "Artifact eraser brush size (pixels):",
        12,
        0
    );
    settings.addMessage(
        "When enabled, FungiGrowthJ shows the binary detection mask. " +
        "Use the Paintbrush with black to erase unwanted white regions " +
        "(dark artifacts) from the detection mask. The source photograph " +
        "is never modified."
    );
    settings.addCheckbox(
        "Enhanced touching-colony partition",
        fgSeededPartitionDefault
    );
    settings.addNumericField(
        "Minimum enclosed interior area (pixels^2):",
        150,
        0
    );
    settings.addNumericField("Minimum candidate area (pixels^2):", 350, 0);
    settings.addNumericField("Maximum candidate area (0 = unlimited):", 0, 0);

    settings.addMessage(
        "\nVERY SMALL / POINT-LIKE COLONIES\n" +
        "Optional low-confidence pass for isolated dark objects smaller than\n" +
        "the normal minimum candidate area. Every object from this pass is\n" +
        "flagged for explicit review and is never silently auto-accepted."
    );

    settings.addCheckbox(
        "Detect very small / point-like colony candidates",
        false
    );
    settings.addNumericField(
        "Minimum very-small candidate area (pixels^2):",
        20,
        0
    );

    settings.addCheckbox("Exclude objects touching agar ROI boundary", true);
    settings.addCheckbox(
        "Mask agar zones manually before detection",
        false
    );

    settings.addMessage(
        "\nREVIEW\n" +
        "Objects are reviewed from lowest to highest circularity."
    );

    settings.addNumericField("Low-circularity alert threshold (0-1):", 0.60, 2);
    settings.addCheckbox("Review only alerted objects", false);
    settings.addCheckbox(
        "Remove ignored ROIs from ROI Manager after review",
        false
    );

    settings.addMessage(
        "\nIgnored ROIs are preserved by default for auditability.\n" +
        "Change these settings only when the image requires it."
    );

    settings.setOKLabel("Detect candidates");
    settings.showDialog();

    if (settings.wasCanceled()) throw "Review canceled.";

    var closingIterations = Math.round(settings.getNextNumber());
    var markerGapClosureIterations = Math.max(
        0,
        Math.round(settings.getNextNumber())
    );
    var cleanDarkArtifactsBeforeDetection =
        settings.getNextBoolean();
    var artifactEraserBrushSize = Math.max(
        1,
        Math.round(settings.getNextNumber())
    );
    var useSeededPartition = settings.getNextBoolean();
    var minimumInteriorArea = Math.max(
        1,
        Math.round(settings.getNextNumber())
    );
    var minimumArea = Math.max(
        1,
        Math.round(settings.getNextNumber())
    );
    var maximumArea = Math.round(settings.getNextNumber());
    var detectVerySmallCandidates = settings.getNextBoolean();
    var minimumVerySmallArea = Math.max(
        1,
        Math.round(settings.getNextNumber())
    );
    var excludeEdgeObjects = settings.getNextBoolean();
    var maskAgarZonesManually = settings.getNextBoolean();

    // The manual exclusion mask is built before colony detection. Width and
    // height must therefore be available before collectManualExclusionZones()
    // is called.
    var width = sourceImage.getWidth();
    var height = sourceImage.getHeight();
    var count = width * height;

    // Initialize manual-exclusion state before the optional masking workflow.
    // The first dialog may be opened immediately after the detection settings,
    // so these variables must already contain usable values.
    var manualExclusionRois = [];
    var manualExclusionMask = null;


    // The second pass is intentionally restricted to objects below the
    // normal candidate threshold. This prevents duplicate detections.
    if (minimumVerySmallArea >= minimumArea) {
        minimumVerySmallArea =
            Math.max(1, minimumArea - 1);
    }
    var lowCircularityThreshold = settings.getNextNumber();
    var reviewOnlyAlerts = settings.getNextBoolean();
    var removeIgnoredRois = settings.getNextBoolean();

    var processor = sourceImage.getProcessor();
    if (!(processor instanceof ColorProcessor)) throw "Invalid RGB processor.";

    // ------------------------------------------------------------
    // OPTIONAL MANUAL DETECTION EXCLUSION MASK
    // ------------------------------------------------------------
    function collectManualExclusionZones() {
        while (true) {
            var maskDialog = new NonBlockingGenericDialog(
                "FungiGrowthJ - Mask Agar Zone"
            );

            maskDialog.addMessage(
                "MASK KNOWN NON-BIOLOGICAL ZONES\n\n" +
                "Draw polygons around handwriting, labels, or other known\n" +
                "non-biological zones inside the agar.\n\n" +
                "The original image is never modified. The mask affects\n" +
                "automatic colony detection only.\n\n" +
                "Current zones: " + manualExclusionRois.length
            );

            maskDialog.addChoice(
                "Action:",
                ["Add polygon zone", "Finish masking"],
                manualExclusionRois.length == 0
                    ? "Add polygon zone"
                    : "Finish masking"
            );
            maskDialog.setOKLabel("Continue");
            maskDialog.showDialog();

            if (maskDialog.wasCanceled()) {
                break;
            }

            var maskAction = maskDialog.getNextChoice();
            if (maskAction == "Finish masking") {
                break;
            }

            sourceImage.deleteRoi();
            if (sourceImage.getWindow() != null) {
                sourceImage.getWindow().toFront();
            }

            var drawDialog = new NonBlockingGenericDialog(
                "FungiGrowthJ - Draw Exclusion Polygon"
            );
            drawDialog.addMessage(
                "Use Fiji's Polygon Selection tool to draw a closed area\n" +
                "around the zone to ignore.\n\n" +
                "Press 'Use polygon' when finished."
            );
            drawDialog.setOKLabel("Use polygon");
            drawDialog.showDialog();

            if (drawDialog.wasCanceled()) {
                continue;
            }

            var zoneRoi = sourceImage.getRoi();
            if (zoneRoi != null && !zoneRoi.isLine()) {
                try { zoneRoi = zoneRoi.clone(); } catch (zoneCloneError) {}
                manualExclusionRois.push(zoneRoi);
            } else {
                IJ.showMessage(
                    "FungiGrowthJ - Mask Agar Zone",
                    "No valid closed area ROI was detected.\n\n" +
                    "Draw the exclusion zone with an area selection tool."
                );
            }
        }

        sourceImage.deleteRoi();

        if (manualExclusionRois.length == 0) {
            return false;
        }

        manualExclusionMask = new ByteProcessor(width, height);
        for (var mx = 0; mx < manualExclusionRois.length; mx++) {
            manualExclusionMask.setValue(255);
            manualExclusionMask.setRoi(manualExclusionRois[mx]);
            manualExclusionMask.fill(manualExclusionRois[mx]);
        }
        manualExclusionMask.resetRoi();
        return true;
    }

    if (maskAgarZonesManually) {
        collectManualExclusionZones();
    }

    var hue = Array.newInstance(Byte.TYPE, count);
    var saturation = Array.newInstance(Byte.TYPE, count);
    var brightness = Array.newInstance(Byte.TYPE, count);
    processor.duplicate().getHSB(hue, saturation, brightness);

    // ------------------------------------------------------------
    // AUTOMATIC ILLUMINATION HANDLING
    // ------------------------------------------------------------
    //
    // The historical detector thresholds the raw Brightness channel with one
    // global IJ_IsoData threshold. That is sensitive to smooth lighting
    // gradients across the plate. We estimate the low-frequency background
    // inside the confirmed agar ROI and only enable a background correction
    // when the robust background spread indicates a meaningful illumination
    // gradient.
    //
    // This remains an automatic decision: the user does not need to know in
    // advance whether a photograph requires correction.
    //
    var illuminationHandling = "ORIGINAL";
    var illuminationMetric = 0.0;
    var illuminationBackgroundSigma = 0.0;
    var detectionBrightness = brightness;

    function percentileFromSorted(values, fraction) {
        if (values.length == 0) return 0.0;
        var pos = (values.length - 1) * fraction;
        var lo = Math.floor(pos);
        var hi = Math.ceil(pos);
        if (lo == hi) return Number(values[lo]);
        var weight = pos - lo;
        return Number(values[lo]) * (1.0 - weight) +
               Number(values[hi]) * weight;
    }

    function prepareDetectionBrightnessAutomatically() {
        var backgroundSigma = Math.max(
            20.0,
            Math.min(width, height) / 30.0
        );

        illuminationBackgroundSigma = backgroundSigma;

        var rawBrightnessImage = new ImagePlus(
            sourceImage.getShortTitle() + "_brightness_for_illumination",
            new ByteProcessor(width, height, brightness, null)
        );

        var blurredBackground = rawBrightnessImage.duplicate();
        blurredBackground.setTitle(
            sourceImage.getShortTitle() + "_illumination_background"
        );

        try {
            IJ.run(
                blurredBackground,
                "Gaussian Blur...",
                "sigma=" + backgroundSigma.toFixed(2)
            );

            var backgroundProcessor =
                blurredBackground.getProcessor();

            var sampledBackground = [];
            var sampleStep = Math.max(
                12,
                Math.round(Math.min(width, height) / 180.0)
            );

            for (var by = 0; by < height; by += sampleStep) {
                for (var bx = 0; bx < width; bx += sampleStep) {
                    if (!agarRoi.contains(bx, by)) continue;
                    if (manualExclusionMask != null && manualExclusionMask.getPixel(bx, by) != 0) continue;
                    sampledBackground.push(
                        backgroundProcessor.getPixel(bx, by)
                    );
                }
            }

            if (sampledBackground.length < 100) {
                return;
            }

            sampledBackground.sort(function(a, b) {
                return a - b;
            });

            var p05 = percentileFromSorted(
                sampledBackground,
                0.05
            );
            var p50 = percentileFromSorted(
                sampledBackground,
                0.50
            );
            var p95 = percentileFromSorted(
                sampledBackground,
                0.95
            );

            illuminationMetric =
                p50 > 0
                ? (p95 - p05) / p50
                : 0.0;

            // 10% robust low-frequency spread is the initial screening
            // threshold for the first validation release. It is deliberately
            // conservative and will be revisited against the validation set.
            if (illuminationMetric < 0.10) {
                return;
            }

            var correctedPixels =
                Array.newInstance(Byte.TYPE, count);

            for (var cy = 0; cy < height; cy++) {
                for (var cx = 0; cx < width; cx++) {
                    var ci = cy * width + cx;
                    var rawValue = brightness[ci] & 255;

                    if (!agarRoi.contains(cx, cy) ||
                        (manualExclusionMask != null && manualExclusionMask.getPixel(cx, cy) != 0)) {
                        correctedPixels[ci] = 0;
                        continue;
                    }

                    var backgroundValue =
                        backgroundProcessor.getPixel(cx, cy);

                    var correctedValue =
                        rawValue - backgroundValue + p50;

                    if (correctedValue < 0) correctedValue = 0;
                    if (correctedValue > 255) correctedValue = 255;

                    correctedPixels[ci] = correctedValue;
                }
            }

            detectionBrightness = correctedPixels;
            illuminationHandling = "AUTO_CORRECTED";

        } finally {
            rawBrightnessImage.close();
            blurredBackground.close();
        }
    }

    prepareDetectionBrightnessAutomatically();

    var histogram = Array.newInstance(Integer.TYPE, 256);
    for (var h = 0; h < 256; h++) histogram[h] = 0;

    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            if (!agarRoi.contains(x, y)) continue;
            if (manualExclusionMask != null && manualExclusionMask.getPixel(x, y) != 0) continue;
            var idx = y * width + x;
            histogram[detectionBrightness[idx] & 255]++;
        }
    }

    var thresholdValue = new AutoThresholder().getThreshold(
        "IJ_IsoData",
        histogram
    );

    var manualDarkArtifactCleanupApplied = false;
    var manualDarkArtifactRemovedPixels = 0;
    var manualDarkArtifactMaskFile = "";

    var maskPixels = Array.newInstance(Byte.TYPE, count);
    for (var my = 0; my < height; my++) {
        for (var mx = 0; mx < width; mx++) {
            var mi = my * width + mx;
            if (!agarRoi.contains(mx, my) ||
                (manualExclusionMask != null && manualExclusionMask.getPixel(mx, my) != 0)) {
                maskPixels[mi] = 0;
            } else {
                maskPixels[mi] = ((detectionBrightness[mi] & 255) <= thresholdValue) ? -1 : 0;
            }
        }
    }

    var maskImage = new ImagePlus(
        sourceImage.getShortTitle() + "_review_mask",
        new ByteProcessor(width, height, maskPixels, null)
    );

    // ------------------------------------------------------------
    // MANUAL DARK-ARTIFACT ERASER
    // ------------------------------------------------------------
    //
    // The thresholded detection mask represents dark image structures as
    // white foreground pixels. When the source image contains isolated
    // black dots, stains, or other non-marker dark artifacts, they can
    // become connected to the true marker contours and form one giant
    // candidate. This optional step lets the user erase those foreground
    // pixels without altering the source photograph.
    // ------------------------------------------------------------
    if (cleanDarkArtifactsBeforeDetection) {

        var beforeArtifactCleanup =
            maskImage.getProcessor().duplicate();

        maskImage.setTitle(
            sourceImage.getShortTitle() + "_artifact_cleanup_mask"
        );
        maskImage.show();

        try {
            if (maskImage.getWindow() != null) {
                maskImage.getWindow().toFront();
            }
        } catch (maskWindowError) {}

        var previousForegroundColor =
            Toolbar.getForegroundColor();
        var previousToolName =
            Toolbar.getToolName();
        var previousBrushSize =
            Toolbar.getBrushSize();

        Toolbar.setForegroundColor(
            new AwtColor(0, 0, 0)
        );
        Toolbar.setBrushSize(
            artifactEraserBrushSize
        );
        Toolbar.getInstance().setTool(
            "Paintbrush Tool"
        );

        var artifactDialog =
            new NonBlockingGenericDialog(
                "FungiGrowthJ - Dark Artifact Eraser"
            );

        artifactDialog.addMessage(
            "DARK ARTIFACT CLEANUP\n\n" +
            "The binary mask is displayed in the image window.\n" +
            "WHITE = currently detected dark structure.\n" +
            "BLACK = background / excluded pixels.\n\n" +
            "Use the Paintbrush with BLACK to erase unwanted white\n" +
            "dots or stains. Do NOT erase the white marker contours\n" +
            "that you want FungiGrowthJ to detect.\n\n" +
            "Brush size: " +
            artifactEraserBrushSize +
            " px\n\n" +
            "The original photograph is never modified."
        );

        artifactDialog.setOKLabel(
            "Done - continue detection"
        );
        artifactDialog.showDialog();

        // The user has closed the non-blocking dialog after performing the
        // cleanup strokes. Count only foreground pixels that were explicitly
        // removed by painting black.
        var cleanedProcessor =
            maskImage.getProcessor();

        for (var artifactCountY = 0;
             artifactCountY < height;
             artifactCountY++) {

            for (var artifactCountX = 0;
                 artifactCountX < width;
                 artifactCountX++) {

                var beforeValue =
                    beforeArtifactCleanup.getPixel(
                        artifactCountX,
                        artifactCountY
                    );

                var afterValue =
                    cleanedProcessor.getPixel(
                        artifactCountX,
                        artifactCountY
                    );

                if (
                    beforeValue != 0 &&
                    afterValue == 0
                ) {
                    manualDarkArtifactRemovedPixels++;
                }
            }
        }

        manualDarkArtifactCleanupApplied =
            manualDarkArtifactRemovedPixels > 0;

        // Restore the user's previous Fiji drawing state.
        try {
            if (previousForegroundColor != null) {
                Toolbar.setForegroundColor(
                    previousForegroundColor
                );
            }
        } catch (restoreColorError) {}

        try {
            if (previousToolName != null &&
                previousToolName != "") {
                Toolbar.getInstance().setTool(
                    previousToolName
                );
            }
        } catch (restoreToolError) {}

        try {
            if (previousBrushSize > 0) {
                Toolbar.setBrushSize(
                    previousBrushSize
                );
            }
        } catch (restoreBrushError) {}

        // Persist the cleaned binary detection mask next to the automatic
        // ROI artifact when Batch supplied an output location.
        if (
            manualDarkArtifactCleanupApplied &&
            fgAutomaticRoisPath != ""
        ) {
            try {
                var ArtifactFileClass =
                    Java.type("java.io.File");

                var artifactParent =
                    new ArtifactFileClass(
                        fgAutomaticRoisPath
                    ).getParentFile();

                if (artifactParent != null) {
                    var artifactMaskFile =
                        new ArtifactFileClass(
                            artifactParent,
                            "dark_artifact_cleanup_mask.tif"
                        );

                    var ArtifactFileSaverClass =
                        Java.type("ij.io.FileSaver");

                    var artifactSaver =
                        new ArtifactFileSaverClass(
                            maskImage
                        );

                    if (
                        artifactSaver.saveAsTiff(
                            artifactMaskFile.getAbsolutePath()
                        )
                    ) {
                        manualDarkArtifactMaskFile =
                            artifactMaskFile.getAbsolutePath();
                    }
                }
            } catch (artifactMaskSaveError) {
                IJ.log(
                    "FungiGrowthJ: could not save dark artifact cleanup mask (non-fatal): " +
                    artifactMaskSaveError
                );
            }
        }

        // Keep maskImage alive: subsequent detection stages operate on
        // this same 8-bit binary mask.
    }

    for (var c = 0; c < closingIterations; c++) {
        IJ.run(maskImage, "Close-", "");
    }

    // ------------------------------------------------------------
    // EXPERIMENTAL: MARKER GAP CLOSURE
    // ------------------------------------------------------------
    // This is intentionally separate from Binary closing. It applies a
    // small dilation to the already thresholded dark-object mask so that
    // short breaks in marker contours can become closed before Fill Holes.
    // The operation is constrained again to the agar ROI and manual
    // exclusion zones afterward, so manual masks remain authoritative.
    //
    // This is a diagnostic feature, not yet a validated default.
    // ------------------------------------------------------------
    if (markerGapClosureIterations > 0) {
        for (
            var markerGapIndex = 0;
            markerGapIndex < markerGapClosureIterations;
            markerGapIndex++
        ) {
            IJ.run(maskImage, "Dilate", "");
        }

        var repairedMaskProcessor =
            maskImage.getProcessor();

        for (var repairY = 0; repairY < height; repairY++) {
            for (var repairX = 0; repairX < width; repairX++) {
                if (
                    !agarRoi.contains(repairX, repairY) ||
                    (
                        manualExclusionMask != null &&
                        manualExclusionMask.getPixel(repairX, repairY) != 0
                    )
                ) {
                    repairedMaskProcessor.putPixel(
                        repairX,
                        repairY,
                        0
                    );
                }
            }
        }
    }

    // ------------------------------------------------------------
    // EXPERIMENTAL: ENCLOSED-INTERIOR SEEDS
    // ------------------------------------------------------------
    //
    // The OUTER edge of the marker remains the operational measurement
    // boundary.  The INNER edge is used only to infer how many separately
    // enclosed colony interiors exist inside a connected outer candidate.
    //
    // These interior regions become SEEDS for a constrained region-growing
    // partition of the ORIGINAL filled outer candidate.  This preserves the
    // original external contour exactly; only internal boundaries between
    // touching colonies are introduced.
    // ------------------------------------------------------------

    var enclosedInteriorCount = 0;
    var enclosedInteriorSeeds = [];
    var manualPartitionSeedCount = 0;

    // Manual-seed local reconstructions keyed by ORIGINAL candidate index.
    // Each entry replaces only that one candidate in the partition proposal.
    var manualSeedLocalRefinements = {};
    var currentPartitionRois = null;
    var manualSeedLocalClosingIterations = 0;

    if (useSeededPartition) {

        var markerProcessorForSeeds =
            maskImage.getProcessor().duplicate();

        var interiorPixels =
            Array.newInstance(
                Byte.TYPE,
                count
            );

        for (var siy = 0; siy < height; siy++) {
            for (var six = 0; six < width; six++) {

                var sii = siy * width + six;

                if (!agarRoi.contains(six, siy)) {
                    interiorPixels[sii] = 0;
                } else {
                    interiorPixels[sii] =
                        markerProcessorForSeeds.getPixel(six, siy) == 0
                        ? -1
                        : 0;
                }
            }
        }

        var interiorImage =
            new ImagePlus(
                sourceImage.getShortTitle() +
                "_enclosed_interior_mask",
                new ByteProcessor(
                    width,
                    height,
                    interiorPixels,
                    null
                )
            );

        var seedRois =
            analyzeParticlesToRois(
                interiorImage,
                minimumInteriorArea,
                Number.POSITIVE_INFINITY,
                false
            );

        var seedRecords = [];
        var largestSeedIndex = -1;
        var largestSeedArea = -1;

        for (
            var si = 0;
            si < seedRois.length;
            si++
        ) {

            var seedRoi =
                seedRois[si];

            if (seedRoi == null) continue;

            interiorImage.setRoi(
                seedRoi
            );

            var seedStats =
                interiorImage.getStatistics();

            var seedArea =
                seedStats != null
                ? Number(seedStats.area)
                : 0;

            var seedBounds =
                seedRoi.getBounds();

            var representativeX = -1;
            var representativeY = -1;

            for (
                var sy0 = seedBounds.y;
                sy0 < seedBounds.y + seedBounds.height &&
                representativeX < 0;
                sy0++
            ) {
                for (
                    var sx0 = seedBounds.x;
                    sx0 < seedBounds.x + seedBounds.width;
                    sx0++
                ) {
                    if (
                        seedRoi.contains(
                            sx0,
                            sy0
                        )
                    ) {
                        representativeX = sx0;
                        representativeY = sy0;
                        break;
                    }
                }
            }

            seedRecords.push({
                roi:
                    seedRoi.clone(),
                area:
                    seedArea,
                representative_x:
                    representativeX,
                representative_y:
                    representativeY
            });

            if (
                seedArea >
                largestSeedArea
            ) {
                largestSeedArea =
                    seedArea;
                largestSeedIndex =
                    seedRecords.length - 1;
            }
        }

        for (
            var ss = 0;
            ss < seedRecords.length;
            ss++
        ) {
            if (
                ss ==
                largestSeedIndex
            ) {
                continue;
            }

            enclosedInteriorSeeds.push(
                seedRecords[ss]
            );
        }

        enclosedInteriorCount =
            enclosedInteriorSeeds.length;

        interiorImage.close();
    }

    // Fill Holes produces the established OUTER-boundary candidate mask.
    // This image is not eroded and no Watershed is applied.
    IJ.run(maskImage, "Fill Holes", "");

    // Detection-window boundary:
    // close masks from previous observations/retries before displaying the
    // current mask. Otherwise an old mask can remain visible and be mistaken
    // for the current image's result.
    var staleDetectionTitles = [
        "_binary_mask",
        "_interactive_agar_mask",
        "_guided_review",
        "_detection_preview"
    ];

    var openImagesBeforeDetection = WindowManager.getImageTitles();

    for (
        var staleTitleIndex = 0;
        staleTitleIndex < openImagesBeforeDetection.length;
        staleTitleIndex++
    ) {
        var staleTitle =
            openImagesBeforeDetection[staleTitleIndex];

        for (
            var stalePatternIndex = 0;
            stalePatternIndex < staleDetectionTitles.length;
            stalePatternIndex++
        ) {
            if (
                staleTitle.indexOf(
                    staleDetectionTitles[stalePatternIndex]
                ) >= 0
            ) {
                var staleImage =
                    WindowManager.getImage(
                        staleTitle
                    );

                if (staleImage != null) {
                    staleImage.changes = false;
                    staleImage.close();
                }

                break;
            }
        }
    }

    // Always target the visible/current ROI Manager first.
    // getInstance2() can return a different manager when an auxiliary
    // manager was created during persistence or when an old visible
    // manager is still open. That can leave stale ROIs on screen.
    var roiManager = RoiManager.getInstance();
    if (roiManager == null) {
        roiManager = RoiManager.getInstance2();
    }
    if (roiManager == null) {
        roiManager = new RoiManager();
    }
    roiManager.reset();

    // Remove any overlay belonging to a previous detection/review.
    sourceImage.setOverlay(null);

    var sizeRange = maximumArea > 0
        ? minimumArea + "-" + maximumArea
        : minimumArea + "-Infinity";


    // Apply the border-artifact filter only after particle detection. This
    // keeps the segmentation/illumination pipeline untouched and limits the
    // new behavior to downstream candidate classification.
    var agarGeometryForBorderFilter =
        getAgarGeometry(agarRoi);

    var borderArtifactCount = 0;
    var borderArtifactSmallPassCount = 0;

    function filterBorderArtifacts(roiList, isVerySmallPass) {
        var kept = [];

        for (var borderIndex = 0;
             borderIndex < roiList.length;
             borderIndex++) {

            var borderRoi = roiList[borderIndex];
            if (borderRoi == null) continue;

            var borderValues =
                measureRoi(
                    sourceImage,
                    borderRoi,
                    0,
                    0
                );

            if (
                isStrongBorderArtifact(
                    borderRoi,
                    borderValues,
                    agarGeometryForBorderFilter
                )
            ) {
                borderArtifactCount++;

                if (isVerySmallPass) {
                    borderArtifactSmallPassCount++;
                }

                continue;
            }

            kept.push(borderRoi);
        }

        return kept;
    }

    var rawNormalCandidateRois =
        analyzeParticlesToRois(
            maskImage,
            minimumArea,
            maximumArea > 0
                ? maximumArea
                : Number.POSITIVE_INFINITY,
            excludeEdgeObjects
        );

    var normalCandidateRois =
        filterBorderArtifacts(
            rawNormalCandidateRois,
            false
        );

    roiManager.reset();

    for (
        var normalRoiIndex = 0;
        normalRoiIndex < normalCandidateRois.length;
        normalRoiIndex++
    ) {
        roiManager.addRoi(
            normalCandidateRois[
                normalRoiIndex
            ].clone()
        );
    }

    // ------------------------------------------------------------
    // LOCAL MANUAL-SEED COLONY REDETECTION
    // ------------------------------------------------------------
    // The manual polygon is temporarily treated as a local "agar ROI".
    // Inside that polygon, FungiGrowthJ reruns the normal dark-marker
    // detection, applies conservative binary closing, fills holes, and
    // extracts a closed colony ROI. The result is then used to replace ONLY
    // the original connected candidate selected by the user.
    // ------------------------------------------------------------
    function detectClosedColonyInsideManualPolygon(
        manualPolygon
    ) {

        // IMPORTANT:
        // The manual polygon is the LOCAL DETECTION WINDOW.
        // Do NOT constrain detection by targetOuterRoi here.
        // The selected proposal ROI may itself be the incorrect object that
        // the user is trying to replace. The polygon must therefore behave
        // like a temporary agar ROI and allow a fresh colony detection from
        // the original marker image.
        var localPixels =
            Array.newInstance(
                Byte.TYPE,
                count
            );

        var polygonBounds =
            manualPolygon.getBounds();

        var startX = Math.max(
            0,
            polygonBounds.x
        );

        var endX = Math.min(
            width,
            polygonBounds.x + polygonBounds.width
        );

        var startY = Math.max(
            0,
            polygonBounds.y
        );

        var endY = Math.min(
            height,
            polygonBounds.y + polygonBounds.height
        );

        for (var ly = startY; ly < endY; ly++) {
            for (var lx = startX; lx < endX; lx++) {
                if (
                    !manualPolygon.contains(lx, ly) ||
                    !agarRoi.contains(lx, ly)
                ) {
                    localPixels[ly * width + lx] = 0;
                    continue;
                }

                if (
                    manualExclusionMask != null &&
                    manualExclusionMask.getPixel(lx, ly) != 0
                ) {
                    localPixels[ly * width + lx] = 0;
                    continue;
                }

                localPixels[ly * width + lx] =
                    ((detectionBrightness[ly * width + lx] & 255) <= thresholdValue)
                    ? -1
                    : 0;
            }
        }

        var localMask = new ImagePlus(
            sourceImage.getShortTitle() + "_manual_seed_local_mask",
            new ByteProcessor(width, height, localPixels, null)
        );

        try {
            // Reuse the established marker-mask closing family, but keep it
            // conservative so the user's polygon remains the dominant local
            // constraint.
            var localClosingIterations = Math.max(
                2,
                Math.min(8, closingIterations)
            );

            manualSeedLocalClosingIterations = localClosingIterations;

            for (var lc = 0; lc < localClosingIterations; lc++) {
                IJ.run(localMask, "Close-", "");
            }

            // The thresholded marker is a *stroke* (a band), not yet the
            // biological colony area.  ImageJ's generic Fill Holes can be
            // sensitive to small local openings and, in the previous
            // experimental versions, could leave the ROI following the
            // marker stroke itself.  Here we explicitly fill only holes
            // enclosed inside the user's local polygon before extracting
            // the colony ROI.
            //
            // 1) Try the standard ImageJ operation first.
            IJ.run(localMask, "Fill Holes", "");

            // 2) Then enforce hole filling inside the manual polygon with a
            // local flood-fill of the black background. This does NOT alter
            // neighboring ROIs; it only changes the temporary local mask.
            function forceFillLocalHoles(processor, polygon) {
                var pb = polygon.getBounds();
                var x0 = Math.max(0, pb.x);
                var x1 = Math.min(width - 1, pb.x + pb.width - 1);
                var y0 = Math.max(0, pb.y);
                var y1 = Math.min(height - 1, pb.y + pb.height - 1);

                var lw = x1 - x0 + 1;
                var lh = y1 - y0 + 1;
                if (lw <= 2 || lh <= 2) return;

                // 0 = local background, 1 = marker/foreground,
                // 2 = background reachable from the local boundary.
                var state = [];
                for (var fy = 0; fy < lh; fy++) {
                    state[fy] = [];
                    for (var fx = 0; fx < lw; fx++) {
                        var px = x0 + fx;
                        var py = y0 + fy;
                        state[fy][fx] =
                            (polygon.contains(px, py) &&
                             processor.getPixel(px, py) != 0)
                            ? 1
                            : 0;
                    }
                }

                var queueX = [];
                var queueY = [];
                var head = 0;

                function enqueueIfBackground(fx, fy) {
                    if (fx < 0 || fx >= lw || fy < 0 || fy >= lh) return;
                    if (state[fy][fx] != 0) return;
                    state[fy][fx] = 2;
                    queueX.push(fx);
                    queueY.push(fy);
                }

                // Seed all local-window edges. Pixels outside the manual
                // polygon are already background and therefore correctly
                // treated as reachable from the outside.
                for (var fxEdge = 0; fxEdge < lw; fxEdge++) {
                    enqueueIfBackground(fxEdge, 0);
                    enqueueIfBackground(fxEdge, lh - 1);
                }
                for (var fyEdge = 0; fyEdge < lh; fyEdge++) {
                    enqueueIfBackground(0, fyEdge);
                    enqueueIfBackground(lw - 1, fyEdge);
                }

                while (head < queueX.length) {
                    var qx = queueX[head];
                    var qy = queueY[head];
                    head++;

                    enqueueIfBackground(qx + 1, qy);
                    enqueueIfBackground(qx - 1, qy);
                    enqueueIfBackground(qx, qy + 1);
                    enqueueIfBackground(qx, qy - 1);
                }

                // Any remaining background component is a closed hole.
                // Fill it as foreground, but only inside the manual polygon.
                for (var fyFill = 0; fyFill < lh; fyFill++) {
                    for (var fxFill = 0; fxFill < lw; fxFill++) {
                        if (state[fyFill][fxFill] === 0) {
                            processor.set(
                                x0 + fxFill,
                                y0 + fyFill,
                                255
                            );
                        }
                    }
                }
            }

            forceFillLocalHoles(
                localMask.getProcessor(),
                manualPolygon
            );

            var localCandidates =
                analyzeParticlesToRois(
                    localMask,
                    1,
                    Number.POSITIVE_INFINITY,
                    false
                );

            var bestRoi = null;
            var bestScore = -1;
            var bestArea = -1;

            for (var lcand = 0; lcand < localCandidates.length; lcand++) {
                var candidate = localCandidates[lcand];
                if (candidate == null) continue;

                // The detected colony must be represented inside the manual
                // polygon. Prefer the candidate with the largest overlap with
                // that polygon, using area only as a deterministic tie-breaker.
                var cb = candidate.getBounds();
                var pb = manualPolygon.getBounds();
                var sx = Math.max(cb.x, pb.x);
                var ex = Math.min(cb.x + cb.width, pb.x + pb.width);
                var sy = Math.max(cb.y, pb.y);
                var ey = Math.min(cb.y + cb.height, pb.y + pb.height);

                var overlap = 0;
                if (sx < ex && sy < ey) {
                    for (var yy = sy; yy < ey; yy++) {
                        for (var xx = sx; xx < ex; xx++) {
                            if (
                                candidate.contains(xx, yy) &&
                                manualPolygon.contains(xx, yy)
                            ) {
                                overlap++;
                            }
                        }
                    }
                }

                if (overlap <= 0) continue;

                var candidateArea =
                    measureRoi(sourceImage, candidate, 0, 0).area;

                if (
                    overlap > bestScore ||
                    (overlap == bestScore && candidateArea > bestArea)
                ) {
                    bestScore = overlap;
                    bestArea = candidateArea;
                    bestRoi = candidate.clone();
                }
            }

            if (bestRoi == null || bestRoi.isLine()) {
                return null;
            }

            return bestRoi;

        } finally {
            localMask.changes = false;
            localMask.close();
        }
    }

    // ------------------------------------------------------------
    // Build a local replacement inside the CURRENT partition proposal.
    // Only the selected proposal ROI is replaced. Neighboring ROIs are kept
    // exactly as proposed; any overlap is left for ROI Review / Cut-Trim.
    // ------------------------------------------------------------
    function buildLocalRefinementForProposal(
        proposalRois,
        targetProposalIndex,
        manualPolygon
    ) {

        if (
            proposalRois == null ||
            targetProposalIndex < 0 ||
            targetProposalIndex >= proposalRois.length
        ) {
            return null;
        }

        var redetectedColony =
            detectClosedColonyInsideManualPolygon(
                manualPolygon
            );

        if (redetectedColony == null) {
            return null;
        }

        // IMPORTANT: a manual polygon is only a local correction for the
        // selected proposal ROI. Do NOT subtract the recovered colony from
        // neighbouring ROIs here. The user is drawing the local detection
        // window freehand, so any resulting overlap is intentionally left for
        // the existing ROI Review / Cut-Trim workflow.
        //
        // The selected ROI is replaced by the freshly detected, closed
        // colony. Every other proposal ROI is preserved exactly as it was.
        var result = [];

        for (var i = 0; i < proposalRois.length; i++) {
            var roi = proposalRois[i];
            if (roi == null) continue;

            if (i == targetProposalIndex) {
                result.push(redetectedColony.clone());
            } else {
                result.push(roi);
            }
        }

        return result;
    }

    // ------------------------------------------------------------
    // MANUAL SEED REFINEMENT
    // ------------------------------------------------------------
    // A small polygon inside a visually distinct colony is used only as an
    // additional partition seed. The user does not redraw the colony boundary.
    // ------------------------------------------------------------
    function collectManualPartitionSeed(proposalRois) {
        if (sourceImage.getWindow() != null) {
            WindowManager.setCurrentWindow(sourceImage.getWindow());
            sourceImage.getWindow().toFront();
        }

        sourceImage.deleteRoi();

        var seedDialog = new NonBlockingGenericDialog(
            "FungiGrowthJ - Add Manual Colony Seed"
        );

        seedDialog.addMessage(
            "ADD A MANUAL COLONY SEED\n\n" +
            "Draw a small closed polygon INSIDE the colony that is\n" +
            "missing or incorrectly represented in the partition.\n\n" +
            "Do NOT trace the colony boundary. The polygon only tells\n" +
            "FungiGrowthJ which region belongs to that colony.\n\n" +
            "When the polygon is ready, press 'Use polygon as seed'."
        );
        seedDialog.setOKLabel("Detect colony from polygon");
        seedDialog.showDialog();

        if (seedDialog.wasCanceled()) {
            return false;
        }

        var seedRoi = sourceImage.getRoi();
        if (seedRoi == null || seedRoi.isLine()) {
            IJ.showMessage(
                "FungiGrowthJ - Manual Colony Seed",
                "No valid area selection was detected.\n\n" +
                "Draw a closed polygon inside the colony and try again."
            );
            sourceImage.deleteRoi();
            return false;
        }

        var candidateSeed = seedRoi.clone();
        var seedBounds = candidateSeed.getBounds();
        var representativeX = -1;
        var representativeY = -1;

        for (var sy = seedBounds.y;
             sy < seedBounds.y + seedBounds.height && representativeX < 0;
             sy++) {
            for (var sx = seedBounds.x;
                 sx < seedBounds.x + seedBounds.width;
                 sx++) {
                if (candidateSeed.contains(sx, sy) && agarRoi.contains(sx, sy)) {
                    representativeX = sx;
                    representativeY = sy;
                    break;
                }
            }
        }

        if (representativeX < 0 || representativeY < 0) {
            IJ.showMessage(
                "FungiGrowthJ - Manual Colony Seed",
                "The seed must be drawn inside the confirmed agar ROI."
            );
            sourceImage.deleteRoi();
            return false;
        }

        // Associate the manual polygon with the CURRENT partition proposal,
        // not with the original connected candidate. This is critical: once
        // Enhanced Partition has already produced acceptable neighboring ROIs,
        // a manual correction must refine ONLY the selected proposal ROI.
        var targetProposalIndex = -1;
        var bestOverlapPixels = 0;

        if (!proposalRois || proposalRois.length == 0) {
            IJ.showMessage(
                "FungiGrowthJ - Manual Colony Seed",
                "There is no current partition proposal to refine."
            );
            sourceImage.deleteRoi();
            return false;
        }

        for (var tpi = 0; tpi < proposalRois.length; tpi++) {
            var proposalRoi = proposalRois[tpi];
            if (proposalRoi == null) continue;

            var proposalBounds = proposalRoi.getBounds();
            var overlapStartX = Math.max(seedBounds.x, proposalBounds.x);
            var overlapEndX = Math.min(
                seedBounds.x + seedBounds.width,
                proposalBounds.x + proposalBounds.width
            );
            var overlapStartY = Math.max(seedBounds.y, proposalBounds.y);
            var overlapEndY = Math.min(
                seedBounds.y + seedBounds.height,
                proposalBounds.y + proposalBounds.height
            );

            var overlapPixels = 0;

            if (overlapStartX < overlapEndX && overlapStartY < overlapEndY) {
                for (var oy = overlapStartY; oy < overlapEndY; oy++) {
                    for (var ox = overlapStartX; ox < overlapEndX; ox++) {
                        if (
                            candidateSeed.contains(ox, oy) &&
                            proposalRoi.contains(ox, oy)
                        ) {
                            overlapPixels++;
                        }
                    }
                }
            }

            if (overlapPixels > bestOverlapPixels) {
                bestOverlapPixels = overlapPixels;
                targetProposalIndex = tpi;
            }
        }

        if (targetProposalIndex < 0 || bestOverlapPixels <= 0) {
            IJ.showMessage(
                "FungiGrowthJ - Manual Colony Seed",
                "The manual polygon does not overlap any colony in the current partition proposal.\n\n" +
                "Draw the polygon inside the specific colony you want to refine."
            );
            sourceImage.deleteRoi();
            return false;
        }

        var localRefinement =
            buildLocalRefinementForProposal(
                proposalRois,
                targetProposalIndex,
                candidateSeed
            );

        if (localRefinement == null || localRefinement.length == 0) {
            IJ.showMessage(
                "FungiGrowthJ - Manual Colony Seed",
                "FungiGrowthJ could not detect a closed colony inside the manual polygon.\n\n" +
                "Draw the polygon around the whole colony, including a small margin around the marker."
            );
            sourceImage.deleteRoi();
            return false;
        }

        // Replace the CURRENT proposal with the local result.
        // Only the selected proposal ROI is replaced; all other proposal ROIs
        // are preserved exactly. Any overlap is handled later in ROI Review.
        proposalRois.length = 0;
        for (var pr = 0; pr < localRefinement.length; pr++) {
            proposalRois.push(localRefinement[pr]);
        }

        // Keep the manual seed record for traceability, but do not use it to
        // rebuild or re-partition any other proposal ROI.
        manualPartitionSeedCount++;
        manualSeedLocalClosingIterations = Math.max(
            2,
            Math.min(8, closingIterations)
        );
        sourceImage.deleteRoi();
        return true;
    }

    var partitionProposalLoop = true;

    while (partitionProposalLoop) {
        partitionProposalLoop = false;

    // ------------------------------------------------------------
    // EXPERIMENTAL SEEDED PARTITION
    // ------------------------------------------------------------
    //
    // Start from the NORMAL outer candidates.  Only a connected outer ROI
    // containing TWO OR MORE enclosed-interior seeds is partitioned.
    //
    // Multi-source region growing is restricted to the pixels of that
    // original outer ROI. Every pixel is assigned to the nearest reachable
    // seed in pixel steps. Therefore:
    //
    //   - the original external boundary is preserved;
    //   - objects with zero/one seed are unchanged;
    //   - only an internal boundary is added where two seed territories meet.
    // ------------------------------------------------------------

    var seededPartitionApplied = false;
    var seededPartitionCandidateCountBefore =
        roiManager.getCount();
    var seededPartitionCandidateCountAfter =
        seededPartitionCandidateCountBefore;

    if (
        useSeededPartition &&
        enclosedInteriorSeeds.length > 0 &&
        roiManager.getCount() > 0
    ) {

        var originalOuterRois = [];

        for (
            var orIndex = 0;
            orIndex < roiManager.getCount();
            orIndex++
        ) {
            var originalOuter =
                roiManager.getRoi(orIndex);

            if (originalOuter != null) {
                originalOuterRois.push(
                    originalOuter
                );
            }
        }

        var partitionedRois = [];

        function addUnchangedOuterRoi(
            outerRoi
        ) {
            partitionedRois.push(
                outerRoi
            );
        }

        function buildSeededPartitionsForOuter(
            outerRoi,
            seedIndexes
        ) {

            var outerBounds =
                outerRoi.getBounds();

            var localWidth =
                outerBounds.width;

            var localHeight =
                outerBounds.height;

            var localCount =
                localWidth * localHeight;

            if (
                localWidth <= 0 ||
                localHeight <= 0 ||
                localCount <= 0
            ) {
                return [];
            }

            var labels =
                Array.newInstance(
                    Integer.TYPE,
                    localCount
                );

            var queue =
                Array.newInstance(
                    Integer.TYPE,
                    localCount
                );

            var queueHead = 0;
            var queueTail = 0;

            // Seed every pixel of each enclosed interior.  Labels are 1-based
            // so 0 can mean "not assigned yet".
            for (
                var localSeedIndex = 0;
                localSeedIndex < seedIndexes.length;
                localSeedIndex++
            ) {

                var globalSeedIndex =
                    seedIndexes[localSeedIndex];

                var seedRoi =
                    enclosedInteriorSeeds[
                        globalSeedIndex
                    ].roi;

                var seedBounds =
                    seedRoi.getBounds();

                var startY =
                    Math.max(
                        outerBounds.y,
                        seedBounds.y
                    );

                var endY =
                    Math.min(
                        outerBounds.y +
                        outerBounds.height,
                        seedBounds.y +
                        seedBounds.height
                    );

                var startX =
                    Math.max(
                        outerBounds.x,
                        seedBounds.x
                    );

                var endX =
                    Math.min(
                        outerBounds.x +
                        outerBounds.width,
                        seedBounds.x +
                        seedBounds.width
                    );

                for (
                    var sy = startY;
                    sy < endY;
                    sy++
                ) {

                    for (
                        var sx = startX;
                        sx < endX;
                        sx++
                    ) {

                        if (
                            !seedRoi.contains(
                                sx,
                                sy
                            ) ||
                            !outerRoi.contains(
                                sx,
                                sy
                            )
                        ) {
                            continue;
                        }

                        var lx =
                            sx -
                            outerBounds.x;

                        var ly =
                            sy -
                            outerBounds.y;

                        var li =
                            ly *
                            localWidth +
                            lx;

                        if (
                            labels[li] == 0
                        ) {

                            labels[li] =
                                localSeedIndex +
                                1;

                            queue[queueTail++] =
                                li;
                        }
                    }
                }
            }

            if (queueTail == 0) {
                return [];
            }

            // 8-connected multi-source growth inside the ORIGINAL outer ROI.
            var neighborDx = [
                -1, 1, 0, 0,
                -1, -1, 1, 1
            ];

            var neighborDy = [
                0, 0, -1, 1,
                -1, 1, -1, 1
            ];

            while (
                queueHead <
                queueTail
            ) {

                var currentIndex =
                    queue[queueHead++];

                var currentLabel =
                    labels[
                        currentIndex
                    ];

                var currentY =
                    Math.floor(
                        currentIndex /
                        localWidth
                    );

                var currentX =
                    currentIndex -
                    currentY *
                    localWidth;

                for (
                    var ni = 0;
                    ni < 8;
                    ni++
                ) {

                    var nx =
                        currentX +
                        neighborDx[ni];

                    var ny =
                        currentY +
                        neighborDy[ni];

                    if (
                        nx < 0 ||
                        nx >= localWidth ||
                        ny < 0 ||
                        ny >= localHeight
                    ) {
                        continue;
                    }

                    var neighborIndex =
                        ny *
                        localWidth +
                        nx;

                    if (
                        labels[
                            neighborIndex
                        ] != 0
                    ) {
                        continue;
                    }

                    var gx =
                        outerBounds.x +
                        nx;

                    var gy =
                        outerBounds.y +
                        ny;

                    if (
                        !outerRoi.contains(
                            gx,
                            gy
                        )
                    ) {
                        continue;
                    }

                    labels[
                        neighborIndex
                    ] =
                        currentLabel;

                    queue[
                        queueTail++
                    ] =
                        neighborIndex;
                }
            }

            var daughters = [];

            for (
                var daughterLabel = 1;
                daughterLabel <= seedIndexes.length;
                daughterLabel++
            ) {

                var daughterPixels =
                    Array.newInstance(
                        Byte.TYPE,
                        localCount
                    );

                var firstDaughterIndex =
                    -1;

                for (
                    var dpi = 0;
                    dpi < localCount;
                    dpi++
                ) {

                    if (
                        labels[dpi] ==
                        daughterLabel
                    ) {

                        daughterPixels[
                            dpi
                        ] = -1;

                        if (
                            firstDaughterIndex < 0
                        ) {
                            firstDaughterIndex =
                                dpi;
                        }
                    }
                }

                if (
                    firstDaughterIndex < 0
                ) {
                    continue;
                }

                var daughterProcessor =
                    new ByteProcessor(
                        localWidth,
                        localHeight,
                        daughterPixels,
                        null
                    );

                var daughterY =
                    Math.floor(
                        firstDaughterIndex /
                        localWidth
                    );

                var daughterX =
                    firstDaughterIndex -
                    daughterY *
                    localWidth;

                var localDaughterRoi =
                    traceSeededRegion(
                        daughterProcessor,
                        daughterX,
                        daughterY
                    );

                if (
                    localDaughterRoi == null
                ) {
                    continue;
                }

                var localBounds =
                    localDaughterRoi
                        .getBounds();

                localDaughterRoi.setLocation(
                    localBounds.x +
                    outerBounds.x,
                    localBounds.y +
                    outerBounds.y
                );

                daughters.push(
                    localDaughterRoi
                );
            }

            return daughters;
        }


        // After the first proposal is shown, manual seeds refine the
        // CURRENT proposal only. Do not rebuild from original outer ROIs,
        // otherwise a second manual seed would silently reset prior edits.
        var hasWorkingPartitionProposal =
            currentPartitionRois != null;

        if (hasWorkingPartitionProposal) {
            partitionedRois = currentPartitionRois;
            seededPartitionApplied = true;
        } else {

        for (
            var outerIndex = 0;
            outerIndex < originalOuterRois.length;
            outerIndex++
        ) {

            var outerRoi =
                originalOuterRois[
                    outerIndex
                ];

            // A manual seed is a local instruction: replace ONLY this
            // original connected candidate with its locally redetected colony
            // plus the untouched remainder. Other candidates are carried
            // forward byte-for-byte.
            if (
                manualSeedLocalRefinements.hasOwnProperty(String(outerIndex))
            ) {
                var localParts =
                    manualSeedLocalRefinements[String(outerIndex)];

                for (var lpi = 0; lpi < localParts.length; lpi++) {
                    partitionedRois.push(localParts[lpi]);
                }

                seededPartitionApplied = true;
                continue;
            }

            var matchingSeedIndexes = [];

            for (
                var esi = 0;
                esi < enclosedInteriorSeeds.length;
                esi++
            ) {

                var seedRecord =
                    enclosedInteriorSeeds[esi];

                var seedBelongsToThisOuter =
                    seedRecord.source != "manual_polygon"
                    || seedRecord.target_outer_index == outerIndex;

                if (
                    seedBelongsToThisOuter &&
                    seedRecord.representative_x >= 0 &&
                    seedRecord.representative_y >= 0 &&
                    outerRoi.contains(
                        seedRecord.representative_x,
                        seedRecord.representative_y
                    )
                ) {
                    matchingSeedIndexes.push(
                        esi
                    );
                }
            }

            if (
                matchingSeedIndexes.length <= 1
            ) {
                addUnchangedOuterRoi(
                    outerRoi
                );
                continue;
            }

            var daughters =
                buildSeededPartitionsForOuter(
                    outerRoi,
                    matchingSeedIndexes
                );

            if (
                daughters.length ==
                matchingSeedIndexes.length
            ) {

                for (
                    var daughterIndex = 0;
                    daughterIndex < daughters.length;
                    daughterIndex++
                ) {
                    partitionedRois.push(
                        daughters[
                            daughterIndex
                        ]
                    );
                }

                seededPartitionApplied =
                    true;

            } else {

                // Conservative fallback: if a complete partition cannot be
                // reconstructed, retain the untouched original outer ROI.
                addUnchangedOuterRoi(
                    outerRoi
                );
            }
        }

        } // end initial proposal reconstruction


        if (
            seededPartitionApplied
        ) {

            // Once the first Enhanced Partition proposal exists, preserve it
            // as the working proposal. Subsequent manual seeds refine only the
            // selected ROI instead of reconstructing the entire outer candidate.
            if (currentPartitionRois == null) {
                currentPartitionRois = partitionedRois.slice();
            } else {
                partitionedRois = currentPartitionRois;
            }

            var partitionPreview =
                sourceImage.duplicate();

            partitionPreview.setTitle(
                sourceImage.getShortTitle() +
                "_SEEDED_PARTITION_PREVIEW"
            );

            var partitionOverlay =
                new Overlay();

            // Magenta = inner-marker seeds.
            for (
                var psi = 0;
                psi < enclosedInteriorSeeds.length;
                psi++
            ) {

                var seedPreviewRoi =
                    enclosedInteriorSeeds[
                        psi
                    ].roi;

                seedPreviewRoi.setStrokeColor(
                    Color.MAGENTA
                );

                seedPreviewRoi.setStrokeWidth(
                    1.5
                );

                partitionOverlay.add(
                    seedPreviewRoi
                );
            }

            // Cyan = proposed final daughter boundaries.
            for (
                var pri = 0;
                pri < partitionedRois.length;
                pri++
            ) {

                var proposedRoi =
                    partitionedRois[pri];

                proposedRoi.setStrokeColor(
                    Color.CYAN
                );

                proposedRoi.setStrokeWidth(
                    2.0
                );

                partitionOverlay.add(
                    proposedRoi
                );
            }

            partitionPreview.setOverlay(
                partitionOverlay
            );

            partitionPreview.show();

            if (
                partitionPreview.getWindow() != null
            ) {
                partitionPreview
                    .getWindow()
                    .toFront();
            }

            var partitionDialog =
                new GenericDialog(
                    "FungiGrowthJ - Enhanced Touching-Colony Partition"
                );

            partitionDialog.addMessage(
                "SEEDED PARTITION PREVIEW\\n\\n" +
                "Magenta = inner marker regions\\n" +
                "Cyan = proposed colony boundaries\\n\\n" +
                "Candidates: " +
                seededPartitionCandidateCountBefore +
                " -> " +
                partitionedRois.length
            );

            partitionDialog.addCheckbox(
                "Use proposed partition",
                true
            );

            partitionDialog.addChoice(
                "Action:",
                [
                    "Continue with proposal",
                    "Add manual colony seed",
                    "Back to Detection & Review Settings"
                ],
                "Continue with proposal"
            );

            partitionDialog.setOKLabel(
                "Continue"
            );

            partitionDialog.showDialog();

            if (
                partitionDialog.wasCanceled()
            ) {

                partitionPreview.close();

                return {
                    status: "REVIEW_BACK_TO_DETECTION_SETTINGS",
                    batch_item_id: fgBatchItemId,
                    single_image_version: FGJ_SingleImage.VERSION,
                    seeded_partition_default: fgSeededPartitionDefault,
                    message: "User returned from the Enhanced partition proposal to Detection & Review Settings."
                };
            }

            var acceptSeededPartition =
                partitionDialog
                    .getNextBoolean();

            var partitionAction =
                partitionDialog
                    .getNextChoice();

            partitionPreview.close();

            if (partitionAction == "Add manual colony seed") {
                var seedAdded = collectManualPartitionSeed(currentPartitionRois);
                if (seedAdded) {
                    partitionProposalLoop = true;
                }
                continue;
            }

            if (partitionAction == "Back to Detection & Review Settings") {
                return {
                    status: "REVIEW_BACK_TO_DETECTION_SETTINGS",
                    batch_item_id: fgBatchItemId,
                    single_image_version: FGJ_SingleImage.VERSION,
                    seeded_partition_default: fgSeededPartitionDefault,
                    message: "User returned from the Enhanced partition proposal to Detection & Review Settings."
                };
            }

            if (
                acceptSeededPartition
            ) {

                roiManager.reset();

                for (
                    var addIndex = 0;
                    addIndex < partitionedRois.length;
                    addIndex++
                ) {
                    roiManager.addRoi(
                        partitionedRois[
                            addIndex
                        ]
                    );
                }

                seededPartitionCandidateCountAfter =
                    roiManager.getCount();

            } else {

                seededPartitionApplied =
                    false;

                seededPartitionCandidateCountAfter =
                    seededPartitionCandidateCountBefore;

                roiManager.reset();

                for (
                    var restoreIndex = 0;
                    restoreIndex < originalOuterRois.length;
                    restoreIndex++
                ) {
                    roiManager.addRoi(
                        originalOuterRois[
                            restoreIndex
                        ]
                    );
                }
            }
        }
    }

    }

    // ------------------------------------------------------------
    // OPTIONAL SECOND PASS — VERY SMALL / POINT-LIKE CANDIDATES
    // ------------------------------------------------------------
    //
    // The normal detector intentionally uses a conservative minimum area.
    // Some experiments contain real colonies that are still only small
    // marker dots. Lowering the main minimum would flood the normal pass
    // with debris and image artifacts, so these objects are detected in a
    // separate low-confidence pass.
    //
    // Scientific / QA rules:
    // - Same binary mask and agar boundary as the normal detector.
    // - Only connected components BELOW minimumArea are eligible.
    // - They enter the same measurement and ROI-review pipeline.
    // - They receive the review flag "very_small_candidate".
    // - They are NEVER silently auto-accepted if the user finishes review
    //   before explicitly classifying them.
    // ------------------------------------------------------------

    var mainCandidateRois = [];
    for (
        var mainRoiIndex = 0;
        mainRoiIndex < roiManager.getCount();
        mainRoiIndex++
    ) {
        var mainRoiForStore =
            roiManager.getRoi(mainRoiIndex);

        if (mainRoiForStore != null) {
            mainCandidateRois.push(
                mainRoiForStore.clone()
            );
        }
    }

    var mainCandidateCount =
        mainCandidateRois.length;

    var verySmallCandidateRois = [];

    if (
        detectVerySmallCandidates &&
        minimumArea > 1 &&
        minimumVerySmallArea < minimumArea
    ) {
        roiManager.reset();

        var smallMaximumArea =
            Math.max(
                minimumVerySmallArea,
                minimumArea - 1
            );

        var smallParticleOptions =
            "size=" +
            minimumVerySmallArea +
            "-" +
            smallMaximumArea +
            " circularity=0.00-1.00 show=Nothing add";

        if (excludeEdgeObjects) {
            smallParticleOptions += " exclude";
        }

        var rawSmallPassRois =
            analyzeParticlesToRois(
                maskImage,
                minimumVerySmallArea,
                smallMaximumArea,
                excludeEdgeObjects
            );

        var smallPassRois =
            filterBorderArtifacts(
                rawSmallPassRois,
                true
            );

        for (
            var smallRoiIndex = 0;
            smallRoiIndex < smallPassRois.length;
            smallRoiIndex++
        ) {
            var smallRoi =
                smallPassRois[
                    smallRoiIndex
                ];

            if (smallRoi != null) {
                verySmallCandidateRois.push(
                    smallRoi.clone()
                );
            }
        }
    }

    var verySmallCandidateCount =
        verySmallCandidateRois.length;

    // Rebuild one manager for the established review workflow.
    roiManager.reset();

    for (
        var rebuildMainIndex = 0;
        rebuildMainIndex < mainCandidateRois.length;
        rebuildMainIndex++
    ) {
        roiManager.addRoi(
            mainCandidateRois[
                rebuildMainIndex
            ]
        );
    }

    for (
        var rebuildSmallIndex = 0;
        rebuildSmallIndex < verySmallCandidateRois.length;
        rebuildSmallIndex++
    ) {
        roiManager.addRoi(
            verySmallCandidateRois[
                rebuildSmallIndex
            ]
        );
    }

    var bounds = agarRoi.getBounds();
    var centerX = bounds.x + bounds.width / 2.0;
    var centerY = bounds.y + bounds.height / 2.0;

    var candidates = [];
    var nearestIndex = -1;
    var nearestDistance = Number.POSITIVE_INFINITY;

    for (var i = 0; i < roiManager.getCount(); i++) {
        var roi = roiManager.getRoi(i);
        if (roi == null) continue;

        var values = measureRoi(sourceImage, roi, centerX, centerY);

        var isVerySmallCandidate =
            i >= mainCandidateCount;

        var initialReviewFlags = [];

        if (isVerySmallCandidate) {
            initialReviewFlags.push(
                "very_small_candidate"
            );
        }

        if (
            values.circularity <
            lowCircularityThreshold
        ) {
            initialReviewFlags.push(
                "low_circularity"
            );
        }

        var candidate = {
            roi_manager_index: i,
            roi: roi,
            object_id: "",
            proposed_type: "",
            final_type: "unreviewed",
            review_status: "pending",
            detection_source:
                isVerySmallCandidate
                ? "very_small_pass"
                : "normal_pass",
            review_flag:
                initialReviewFlags.join("|"),
            edited_manually: false,
            review_note: "",
            parent_object_id: "",
            edit_operation: "NONE"
        };

        copyMeasurements(candidate, values);
        candidates.push(candidate);

        if (values.distance_to_center_px < nearestDistance) {
            nearestDistance = values.distance_to_center_px;
            nearestIndex = candidates.length - 1;
        }
    }
    sourceImage.deleteRoi();

    function padColonyId(number) {
        var value = String(number);

        while (value.length < 3) {
            value = "0" + value;
        }

        return "C" + value;
    }

    var colonyCounter = 1;

    for (var j = 0;
         j < candidates.length;
         j++) {

        var item =
            candidates[j];

        item.object_id =
            padColonyId(
                colonyCounter++
            );

        if (j == nearestIndex) {
            item.proposed_type = "central";
        } else {
            item.proposed_type = "candidate_satellite";
        }

        roiManager.rename(
            item.roi_manager_index,
            item.object_id
        );
    }

    // ------------------------------------------------------------
    // Persist the untouched automatic segmentation before review.
    // ------------------------------------------------------------

    var automaticRoisSavedPath = "";

    if (fgAutomaticRoisPath != "") {
        var automaticRoisForSave = [];
        var automaticNamesForSave = [];

        for (var ar = 0; ar < candidates.length; ar++) {
            automaticRoisForSave.push(candidates[ar].roi);
            automaticNamesForSave.push(
                candidates[ar].object_id + "_automatic"
            );
        }

        automaticRoisSavedPath = saveRoiZip(
            fgAutomaticRoisPath,
            automaticRoisForSave,
            automaticNamesForSave
        );

        // saveRoiZip uses a dedicated hidden manager, so the active review
        // manager remains untouched and does not need to be rebuilt here.
    }

    // ============================================================
    // QA CHECKPOINT — CANDIDATE DETECTION
    // ============================================================
    //
    // Never allow an image with zero detected colony candidates to
    // silently skip Step 5 and be exported as if analysis succeeded.
    //

    if (candidates.length == 0) {

        sourceImage.deleteRoi();

        if (
            typeof maskImage !== "undefined" &&
            maskImage != null
        ) {

            try {
                maskImage.show();
                maskImage.getWindow().toFront();
            } catch (maskPreviewError) {
                // Diagnostic preview is optional.
            }
        }

        var zeroCandidateDialog =
            new GenericDialog(
                "FungiGrowthJ - No Colony Candidates"
            );

        addStepIndicator(
            zeroCandidateDialog,
            4,
            6


        );



        zeroCandidateDialog.addMessage(
            
            "No colony objects were detected inside the confirmed agar ROI.\n\n" +
            "This image CANNOT be marked as completed.\n\n" +
            "Possible causes include:\n" +
            "- the marker threshold did not capture the drawn contours;\n" +
            "- minimum candidate area is too high;\n" +
            "- the confirmed agar ROI does not cover the expected region;\n" +
            "- marker contrast differs from the previous image.\n\n" +
            "The binary review mask has been opened when possible so you can\n" +
            "inspect what FungiGrowthJ detected."
        );

        zeroCandidateDialog.addChoice(
            "Action:",
            [
                "Return to detection settings",
                "Mark this observation for later review",
                "Cancel observation"
            ],
            "Return to detection settings"
        );

        zeroCandidateDialog.setOKLabel(
            "Continue"
        );

        zeroCandidateDialog.showDialog();

        if (zeroCandidateDialog.wasCanceled()) {
            throw new Error(
                "NO_CANDIDATES: observation canceled by user."
            );
        }

        var zeroCandidateAction =
            zeroCandidateDialog.getNextChoice();

        if (
            zeroCandidateAction ==
            "Return to detection settings"
        ) {
            return {
                status: "RESTART_DETECTION",
                batch_item_id: fgBatchItemId,
                single_image_version: FGJ_SingleImage.VERSION,

                // This is a detection-only restart. Preserve the setup
                // already confirmed for this image.
                seeded_partition_default:
                    context.seeded_partition_default === true,

                calibration: {
                    unit: scaleUnit,
                    unit_per_pixel: unitPerPixel,
                    pixels_per_unit: pixelsPerUnit,
                    known_distance: knownDistance,
                    line_length_pixels: lineLengthPixels,
                    reused: true
                },

                message:
                    "No candidates were detected. Return to Detection Settings was requested; confirmed scale and agar setup will be preserved."
            };
        }

        if (
            zeroCandidateAction ==
            "Mark this observation for later review"
        ) {
            return {
                status: "REVIEW_DEFERRED",
                batch_item_id: fgBatchItemId,
                single_image_version: FGJ_SingleImage.VERSION,
                message:
                    "Observation deferred after zero-candidate detection."
            };
        }

        throw new Error(
            "NO_CANDIDATES: observation canceled by user."
        );
    }


    var candidateCheckpoint =
        new GenericDialog(
            "FungiGrowthJ - Candidate Detection"
        );

    var candidateHeader =
        new Panel(
            new FlowLayout(FlowLayout.LEFT, 5, 0)
        );

    var candidateTitle =
        new Label("CANDIDATE DETECTION COMPLETE");

    candidateTitle.setFont(
        new AwtFont("SansSerif", AwtFont.BOLD, 15)
    );

    candidateTitle.setForeground(
        new AwtColor(0, 120, 70)
    );

    candidateHeader.add(candidateTitle);
    candidateCheckpoint.addPanel(candidateHeader);

    addStepIndicator(
        candidateCheckpoint,
        4,
        6


    );



    candidateCheckpoint.addMessage(
        
        "Detected inside agar ROI:"
    );

    candidateCheckpoint.addMessage(
        "Illumination handling: " +
        (illuminationHandling == "AUTO_CORRECTED"
            ? "AUTOMATIC BACKGROUND CORRECTION"
            : "ORIGINAL BRIGHTNESS") +
        "\nBackground spread metric: " +
        illuminationMetric.toFixed(3)
    );

    var candidateCountPanel =
        new Panel(new FlowLayout(FlowLayout.LEFT, 8, 0));

    var candidateCount =
        new Label(String(candidates.length) + " candidate object(s)");

    candidateCount.setFont(
        new AwtFont("SansSerif", AwtFont.BOLD, 14)
    );

    candidateCountPanel.add(candidateCount);
    candidateCheckpoint.addPanel(candidateCountPanel);

    candidateCheckpoint.addMessage(
        (
            detectVerySmallCandidates
            ? "\nVERY SMALL PASS\n" +
              verySmallCandidateCount +
              " low-confidence point-like candidate(s) added.\n" +
              "These candidates require explicit review and will not be\n" +
              "silently accepted if you finish the review early.\n"
            : ""
        ) +
        "\nNEXT STEP — GUIDED ROI REVIEW\n" +
        "Inspect the detected contours on the image before continuing.\n" +
        "If the result suggests that the experimental touching-colony\n" +
        "partition should be changed, you can redo detection now."
    );

    candidateCheckpoint.addChoice(
        "Action:",
        [
            "Start ROI review",
            "Redo detection with Enhanced partition ON",
            "Redo detection with Enhanced partition OFF",
            "Mark this observation for later review"
        ],
        "Start ROI review"
    );

    candidateCheckpoint.setOKLabel(
        "Continue"
    );

    candidateCheckpoint.showDialog();

    if (candidateCheckpoint.wasCanceled()) {

        throw new Error(
            "Candidate review canceled before Step 5."
        );
    }

    var candidateCheckpointAction =
        candidateCheckpoint.getNextChoice();

    if (
        candidateCheckpointAction ==
        "Redo detection with Enhanced partition ON" ||
        candidateCheckpointAction ==
        "Redo detection with Enhanced partition OFF"
    ) {
        return {
            status: "RESTART_DETECTION",
            batch_item_id: fgBatchItemId,
            single_image_version: FGJ_SingleImage.VERSION,
            seeded_partition_default:
                candidateCheckpointAction ==
                "Redo detection with Enhanced partition ON",

            // A detection-only redo must preserve the calibration already
            // confirmed for this observation. Batch reuses this object only
            // for the immediate restart; it does not overwrite project scale.
            calibration: {
                unit: scaleUnit,
                unit_per_pixel: unitPerPixel,
                pixels_per_unit: pixelsPerUnit,
                known_distance: knownDistance,
                line_length_pixels: lineLengthPixels,
                reused: true
            },

            message: "User requested candidate detection again after visually checking the current result; the confirmed image scale will be preserved."
        };
    }

    if (
        candidateCheckpointAction ==
        "Mark this observation for later review"
    ) {
        return {
            status: "REVIEW_DEFERRED",
            batch_item_id: fgBatchItemId,
            single_image_version: FGJ_SingleImage.VERSION,
            message: "User deferred the observation after candidate detection."
        };
    }


    var reviewQueue = candidates.slice(0);
    reviewQueue.sort(function(a, b) {
        return a.circularity - b.circularity;
    });

    if (reviewOnlyAlerts) {
        reviewQueue = reviewQueue.filter(function(item) {
            return item.review_flag != "";
        });
    }

    // Defensive boundary: only the candidates generated for THIS image
    // may enter the visible review manager.
    roiManager.reset();

    for (
        var reviewManagerIndex = 0;
        reviewManagerIndex < candidates.length;
        reviewManagerIndex++
    ) {
        if (candidates[reviewManagerIndex].roi != null) {
            roiManager.addRoi(
                candidates[reviewManagerIndex].roi.clone()
            );
        }
    }

    var reviewImage = sourceImage.duplicate();
    reviewImage.setTitle(sourceImage.getShortTitle() + "_guided_review");
    reviewImage.setOverlay(null);
    reviewImage.show();
    roiManager.setVisible(true);

    if (
        roiManager.getCount() != candidates.length
    ) {
        throw new Error(
            "ROI_MANAGER_CURRENT_IMAGE_MISMATCH: visible ROI Manager contains " +
            roiManager.getCount() +
            " ROI(s), but the current image has " +
            candidates.length +
            " candidate(s)."
        );
    }


    // ------------------------------------------------------------
    // HELPER FUNCTION — Build a preview of the current decisions
    // ------------------------------------------------------------
    //
    // Reviewed objects use their confirmed final type.
    // Unreviewed objects are provisionally shown using the automatic
    // proposal, because they would be accepted with that type if the
    // user finishes the review.
    //
    // Ignored objects are omitted from the preview.
    //

    function updateDecisionPreview(activeCandidate) {

        var overlay =
            new Overlay();

        for (var previewIndex = 0;
             previewIndex < candidates.length;
             previewIndex++) {

            var previewCandidate =
                candidates[previewIndex];

            var previewRoi =
                previewCandidate.roi;

            if (previewRoi == null) {
                continue;
            }

            var isActive =
                activeCandidate != null &&
                previewCandidate.object_id ==
                activeCandidate.object_id;

            var strokeColor;
            var strokeWidth = 2.0;

            // Active object always has highest visual priority.
            if (isActive) {

                strokeColor =
                    Color.RED;

                strokeWidth =
                    5.0;

            } else if (
                (
                    previewCandidate.edit_operation == "ROI_SPLIT" ||
                    previewCandidate.edit_operation == "ROI_CUT"
                )
                &&
                previewCandidate.review_status ==
                "pending"
            ) {

                // Newly created split daughter, not reviewed yet.
                strokeColor =
                    Color.CYAN;

                strokeWidth =
                    3.0;

            } else if (
                previewCandidate.final_type ==
                "ignore"
            ) {

                strokeColor =
                    Color.GRAY;

            } else if (
                previewCandidate.review_status ==
                "confirmed" ||
                previewCandidate.review_status ==
                "auto_accepted_after_preview"
            ) {

                strokeColor =
                    Color.GREEN;

            } else {

                // Pending / unreviewed.
                strokeColor =
                    Color.YELLOW;
            }

            previewRoi.setStrokeColor(
                strokeColor
            );

            previewRoi.setStrokeWidth(
                strokeWidth
            );

            overlay.add(
                previewRoi
            );

            var labelText =
                previewCandidate.object_id;

            if (isActive) {
                labelText += "  ACTIVE";
            }

            var label =
                new TextRoi(
                    Math.round(
                        previewCandidate
                            .centroid_x_px
                    ),
                    Math.round(
                        previewCandidate
                            .centroid_y_px
                    ),
                    labelText,
                    new Font(
                        "SansSerif",
                        isActive
                            ? Font.BOLD
                            : Font.PLAIN,
                        isActive
                            ? 18
                            : 12
                    )
                );

            label.setStrokeColor(
                strokeColor
            );

            overlay.add(
                label
            );
        }

        reviewImage.setOverlay(
            overlay
        );

        reviewImage.updateAndDraw();
    }


    // ------------------------------------------------------------
    // HELPER FUNCTION — Count current review states
    // ------------------------------------------------------------

    function countReviewStates() {

        var counts = {
            confirmed: 0,
            ignored: 0,
            deferred: 0,
            unreviewed: 0
        };

        for (var c = 0; c < candidates.length; c++) {

            var state = candidates[c].final_type;

            if (state == "ignore") {
                counts.ignored++;
            } else if (state == "defer") {
                counts.deferred++;
            } else if (state == "unreviewed") {
                counts.unreviewed++;
            } else {
                counts.confirmed++;
            }
        }

        return counts;
    }



    // ------------------------------------------------------------
    // HELPER FUNCTION — Capture one daughter ROI
    // ------------------------------------------------------------

    function captureSplitDaughter(
        daughterNumber,
        daughterTotal,
        parentId
    ) {

        while (true) {

            var instruction =
                new NonBlockingGenericDialog(
                    "FungiGrowthJ - Split " +
                    parentId +
                    ": colony " +
                    daughterNumber +
                    " of " +
                    daughterTotal
                );

            var splitDrawHeader =
                new Panel(new FlowLayout(FlowLayout.LEFT, 5, 0));

            var splitDrawTitle =
                new Label(
                    "DRAW COLONY " +
                    daughterNumber +
                    " OF " +
                    daughterTotal
                );

            splitDrawTitle.setFont(
                new AwtFont("SansSerif", AwtFont.BOLD, 15)
            );

            splitDrawTitle.setForeground(
                new AwtColor(0, 125, 145)
            );

            splitDrawHeader.add(splitDrawTitle);
            instruction.addPanel(splitDrawHeader);

            addStepIndicator(
                instruction,
                5,
                6


            );



            instruction.addMessage(
                
                "Splitting merged object: " + parentId + "\n\n" +
                "DRAW THIS COLONY\n" +
                "1. Use a CLOSED area-selection tool.\n" +
                "2. Follow only this colony's biological boundary.\n" +
                "3. Do not include neighboring colonies.\n" +
                "4. Leave the completed ROI active, then continue.\n\n" +
                (
                    daughterNumber < daughterTotal
                    ? "Next: colony " + (daughterNumber + 1) +
                      " of " + daughterTotal + "."
                    : "Last colony: the complete split will be previewed next."
                )
            );

            instruction.setOKLabel(
                daughterNumber < daughterTotal
                    ? "Next colony"
                    : "Preview split"
            );

            instruction.showDialog();

            if (instruction.wasCanceled()) {
                return null;
            }

            var drawn =
                reviewImage.getRoi();

            if (drawn != null &&
                !drawn.isLine()) {

                try {
                    return drawn.clone();
                } catch (cloneError) {
                    return drawn;
                }
            }

            IJ.showMessage(
                "FungiGrowthJ - Split ROI",
                "No valid closed ROI was detected.\n\n" +
                "Draw an area selection around colony " +
                daughterNumber +
                " and try again."
            );
        }
    }


    // ------------------------------------------------------------
    // HELPER FUNCTION — Build a daughter candidate
    // ------------------------------------------------------------

    function createSplitChild(
        childRoi,
        parentCandidate
    ) {

        var measurements =
            measureRoi(
                reviewImage,
                childRoi,
                centerX,
                centerY
            );

        var child = {
            roi_manager_index: -1,
            roi: childRoi,
            object_id:
                padColonyId(
                    colonyCounter++
                ),
            proposed_type:
                "candidate_satellite",
            final_type:
                "unreviewed",
            review_status:
                "pending",
            review_flag:
                measurements.circularity <
                lowCircularityThreshold
                ? "low_circularity_after_split"
                : "",
            edited_manually:
                true,
            review_note:
                "Created by splitting " +
                parentCandidate.object_id +
                ".",
            parent_object_id:
                parentCandidate.object_id,
            edit_operation:
                "ROI_SPLIT"
        };

        copyMeasurements(
            child,
            measurements
        );

        return child;
    }


    // ------------------------------------------------------------
    // HELPER FUNCTION — Split one merged object into N colonies
    // ------------------------------------------------------------

    function splitCandidate(
        parentCandidate
    ) {

        // Every split starts from a clean visual/ROI state.
        // This makes repeated splits within the same image independent.
        reviewImage.setOverlay(
            null
        );

        if (parentCandidate.roi != null) {

            reviewImage.setRoi(
                parentCandidate.roi
            );

            reviewImage.updateAndDraw();
        }

        reviewImage.getWindow()
            .toFront();

        IJ.showStatus(
            "FungiGrowthJ: splitting " +
            parentCandidate.object_id
        );

        var numberDialog =
            new NonBlockingGenericDialog(
                "FungiGrowthJ - Split " +
                parentCandidate.object_id
            );

        addStepIndicator(
            numberDialog,
            5,
            6


        );



        numberDialog.addMessage(
            
            "SPLIT REQUESTED FOR: " +
            parentCandidate.object_id +
            "\n\n" +
            "This object contains more than one biological colony.\n\n" +
            "How many distinct colonies are merged in this object?\n\n" +
            "After pressing Continue, FungiGrowthJ will guide you\n" +
            "through colony 1 of N, colony 2 of N, and so on."
        );

        numberDialog.addNumericField(
            "Number of colonies:",
            2,
            0
        );

        numberDialog.setOKLabel(
            "Continue split"
        );

        numberDialog.showDialog();

        if (numberDialog.wasCanceled()) {
            return null;
        }

        var daughterTotal =
            Math.round(
                numberDialog.getNextNumber()
            );

        if (isNaN(daughterTotal) ||
            daughterTotal < 2) {

            IJ.showMessage(
                "FungiGrowthJ - Split ROI",
                "A split requires at least 2 colonies."
            );

            return null;
        }

        if (daughterTotal > 10) {

            IJ.showMessage(
                "FungiGrowthJ - Split ROI",
                "For quality control, one merged object can be split into\n" +
                "a maximum of 10 colonies at a time."
            );

            return null;
        }

        while (true) {

            var daughterRois = [];
            var canceled = false;

            reviewImage.setOverlay(
                null
            );

            for (var daughterIndex = 1;
                 daughterIndex <= daughterTotal;
                 daughterIndex++) {

                var daughterRoi =
                    captureSplitDaughter(
                        daughterIndex,
                        daughterTotal,
                        parentCandidate.object_id
                    );

                if (daughterRoi == null) {
                    canceled = true;
                    break;
                }

                daughterRois.push(
                    daughterRoi
                );
            }

            if (canceled) {
                reviewImage.setOverlay(null);
                return null;
            }

            // Preview all daughter colonies together.
            var splitOverlay =
                new Overlay();

            var parentPreview =
                parentCandidate.roi;

            parentPreview.setStrokeColor(
                Color.GRAY
            );

            parentPreview.setStrokeWidth(
                2.0
            );

            splitOverlay.add(
                parentPreview
            );

            var daughterMeasurements = [];

            for (var previewDaughter = 0;
                 previewDaughter < daughterRois.length;
                 previewDaughter++) {

                var dRoi =
                    daughterRois[
                        previewDaughter
                    ];

                var dMeasurements =
                    measureRoi(
                        reviewImage,
                        dRoi,
                        centerX,
                        centerY
                    );

                daughterMeasurements.push(
                    dMeasurements
                );

                dRoi.setStrokeColor(
                    Color.CYAN
                );

                dRoi.setStrokeWidth(
                    4.0
                );

                splitOverlay.add(
                    dRoi
                );

                var daughterLabel =
                    new TextRoi(
                        Math.round(
                            dMeasurements
                                .centroid_x_px
                        ),
                        Math.round(
                            dMeasurements
                                .centroid_y_px
                        ),
                        "colony " +
                        (previewDaughter + 1),
                        new Font(
                            "SansSerif",
                            Font.BOLD,
                            16
                        )
                    );

                daughterLabel.setStrokeColor(
                    Color.CYAN
                );

                splitOverlay.add(
                    daughterLabel
                );
            }

            reviewImage.setOverlay(
                splitOverlay
            );

            reviewImage.getWindow()
                .toFront();

            var confirmSplit =
                new NonBlockingGenericDialog(
                    "FungiGrowthJ - Confirm Multi-Colony Split"
                );

            addStepIndicator(
                confirmSplit,
                5,
                6
            );

            var summary =
                "All " +
                daughterTotal +
                " daughter colonies are now shown in CYAN.\n" +
                "The original merged object is shown in GRAY.\n\n";

            for (var summaryIndex = 0;
                 summaryIndex < daughterMeasurements.length;
                 summaryIndex++) {

                summary +=
                    "Colony " +
                    (summaryIndex + 1) +
                    " area: " +
                    daughterMeasurements[
                        summaryIndex
                    ].area_px2.toFixed(1) +
                    " px^2\n";
            }

            summary +=
                "\nAccept only if every biological colony is represented\n" +
                "once, boundaries are correct, and daughter ROIs do not overlap.";

            var splitConfirmHeader =
                new Panel(new FlowLayout(FlowLayout.LEFT, 5, 0));

            var splitConfirmTitle =
                new Label("CONFIRM SPLIT");

            splitConfirmTitle.setFont(
                new AwtFont("SansSerif", AwtFont.BOLD, 15)
            );

            splitConfirmTitle.setForeground(
                new AwtColor(0, 125, 145)
            );

            splitConfirmHeader.add(splitConfirmTitle);
            confirmSplit.addPanel(splitConfirmHeader);

            confirmSplit.addMessage(
                summary
            );

            confirmSplit.addChoice(
                "Split decision:",
                [
                    "Accept split",
                    "Redraw all daughter colonies",
                    "Cancel split"
                ],
                "Accept split"
            );

            confirmSplit.showDialog();

            if (confirmSplit.wasCanceled()) {
                reviewImage.setOverlay(null);
                return null;
            }

            var splitDecision =
                confirmSplit.getNextChoice();

            if (splitDecision ==
                "Cancel split") {

                reviewImage.setOverlay(null);
                return null;
            }

            if (splitDecision ==
                "Redraw all daughter colonies") {

                reviewImage.setOverlay(null);
                continue;
            }

            var children = [];

            for (var childIndex = 0;
                 childIndex < daughterRois.length;
                 childIndex++) {

                var child =
                    createSplitChild(
                        daughterRois[
                            childIndex
                        ],
                        parentCandidate
                    );

                reviewImage.setRoi(
                    child.roi
                );

                roiManager.addRoi(
                    child.roi
                );

                child.roi_manager_index =
                    roiManager.getCount() - 1;

                roiManager.rename(
                    child.roi_manager_index,
                    child.object_id
                );

                children.push(
                    child
                );
            }

            parentCandidate.final_type =
                "ignore";

            parentCandidate.review_status =
                "confirmed";

            parentCandidate.edited_manually =
                true;

            parentCandidate.edit_operation =
                "ROI_SPLIT_PARENT";

            var childIds = [];

            for (var idIndex = 0;
                 idIndex < children.length;
                 idIndex++) {

                childIds.push(
                    children[idIndex]
                        .object_id
                );
            }

            parentCandidate.review_note =
                "Split into " +
                childIds.join(", ") +
                ".";

            reviewImage.setOverlay(
                null
            );

            return children;
        }
    }


    // ------------------------------------------------------------
    // HELPER FUNCTION — Create a narrow cut shape from any Fiji line ROI
    // ------------------------------------------------------------
    //
    // Straight, segmented and freehand lines are accepted. FG never changes
    // the user's selected Fiji tool. The user's
    // line is converted into a narrow brush stroke made from overlapping
    // circular ROIs. This lets the cut follow an irregular biological
    // boundary without redrawing either colony contour.
    // ------------------------------------------------------------

    function cutShapeFromLine(lineRoi, widthPx) {

        if (lineRoi == null || !lineRoi.isLine()) {
            return null;
        }

        var polygon = lineRoi.getFloatPolygon();
        if (polygon == null || polygon.npoints < 2) {
            return null;
        }

        var diameter = Math.max(1.0, Number(widthPx));
        var radius = diameter / 2.0;
        var sampleStep = Math.max(0.5, radius * 0.70);

        var brushShape = null;

        function addBrushStamp(x, y) {

            var stamp = new ShapeRoi(
                new OvalRoi(
                    x - radius,
                    y - radius,
                    diameter,
                    diameter
                )
            );

            if (brushShape == null) {
                brushShape = stamp;
            } else {
                brushShape = brushShape.or(stamp);
            }
        }

        for (var p = 0; p < polygon.npoints - 1; p++) {

            var x1 = polygon.xpoints[p];
            var y1 = polygon.ypoints[p];
            var x2 = polygon.xpoints[p + 1];
            var y2 = polygon.ypoints[p + 1];

            var dx = x2 - x1;
            var dy = y2 - y1;
            var segmentLength = Math.sqrt(dx * dx + dy * dy);

            if (segmentLength <= 0.0) {
                addBrushStamp(x1, y1);
                continue;
            }

            var steps = Math.max(
                1,
                Math.ceil(segmentLength / sampleStep)
            );

            for (var s = 0; s <= steps; s++) {

                var fraction = s / steps;

                addBrushStamp(
                    x1 + dx * fraction,
                    y1 + dy * fraction
                );
            }
        }

        return brushShape;
    }


    // ------------------------------------------------------------
    // HELPER FUNCTION — Build a candidate from a cut fragment
    // ------------------------------------------------------------

    function createCutFragment(
        fragmentRoi,
        parentCandidate,
        keepFragment
    ) {

        var measurements = measureRoi(
            reviewImage,
            fragmentRoi,
            centerX,
            centerY
        );

        var child = {
            roi_manager_index: -1,
            roi: fragmentRoi,
            object_id: padColonyId(colonyCounter++),
            proposed_type: "candidate_satellite",
            final_type: keepFragment ? "unreviewed" : "ignore",
            review_status: keepFragment ? "pending" : "confirmed",
            review_flag:
                measurements.circularity < lowCircularityThreshold
                ? "low_circularity_after_cut"
                : "",
            edited_manually: true,
            review_note:
                keepFragment
                ? "Created by cutting " + parentCandidate.object_id + "."
                : "Discarded fragment created by cutting " + parentCandidate.object_id + ".",
            parent_object_id: parentCandidate.object_id,
            edit_operation:
                keepFragment
                ? "ROI_CUT"
                : "ROI_CUT_DISCARD"
        };

        copyMeasurements(child, measurements);
        return child;
    }


    // ------------------------------------------------------------
    // HELPER FUNCTION — Cut / trim an automatic ROI with freehand lines
    // ------------------------------------------------------------
    // The outer automatic contour is preserved. Only narrow user-drawn
    // user-drawn cut strokes are subtracted. The resulting connected fragments are
    // then explicitly kept or discarded by the user.

    function cutTrimCandidate(parentCandidate) {

        reviewImage.setOverlay(null);
        reviewImage.setRoi(parentCandidate.roi);
        reviewImage.updateAndDraw();
        reviewImage.getWindow().toFront();

        var currentShape = new ShapeRoi(parentCandidate.roi);
        var history = [];
        var cutCount = 0;

        // Keep the cutting stroke deliberately narrow. This is an internal
        // geometric parameter, not a requested number of cuts or colonies.
        var cutWidthPx = 2.0;
        var previewRequested = false;

        while (true) {

            if (!previewRequested) {

                reviewImage.setOverlay(null);
                reviewImage.setRoi(currentShape);
                reviewImage.updateAndDraw();
                reviewImage.getWindow().toFront();

                var cutDialog = new NonBlockingGenericDialog(
                    "FungiGrowthJ - Cut / Trim " + parentCandidate.object_id
                );

                addStepIndicator(cutDialog, 5, 6);

                cutDialog.addMessage(
                    "CUT / TRIM AUTOMATIC ROI\n\n" +
                    "Cut #" + (cutCount + 1) + "\n\n" +
                    "Draw ONE separation using the line tool you prefer.\n" +
                    "Straight, segmented and freehand line ROIs are accepted.\n" +
                    "FG will NOT change your currently selected Fiji tool.\n\n" +
                    "Follow the biological boundary as closely as necessary and\n" +
                    "extend the stroke completely across the connection.\n\n" +
                    "The automatic outer contour is preserved. You can make as\n" +
                    "many cuts as necessary; FG does NOT ask how many colonies\n" +
                    "or cuts there should be."
                );

                cutDialog.setOKLabel("Apply this cut");
                cutDialog.showDialog();

                if (cutDialog.wasCanceled()) {
                    reviewImage.setOverlay(null);
                    return null;
                }

                var lineRoi = reviewImage.getRoi();

                if (lineRoi == null || !lineRoi.isLine()) {
                    IJ.showMessage(
                        "FungiGrowthJ - Cut / Trim ROI",
                        "No valid cutting line was detected.\n\n" +
                        "Draw the separation with any Fiji line ROI tool,\n" +
                        "then press Apply this cut."
                    );
                    continue;
                }

                var strip = cutShapeFromLine(lineRoi, cutWidthPx);

                if (strip == null) {
                    IJ.showMessage(
                        "FungiGrowthJ - Cut / Trim ROI",
                        "The drawn line could not be converted to a valid cut."
                    );
                    continue;
                }

                var previousShape;
                try {
                    previousShape = currentShape.clone();
                } catch (shapeCloneError) {
                    previousShape = new ShapeRoi(currentShape);
                }

                history.push(previousShape);

                currentShape = new ShapeRoi(currentShape).not(
                    new ShapeRoi(strip)
                );

                cutCount++;

                reviewImage.setRoi(currentShape);
                reviewImage.updateAndDraw();

                var nextDialog = new NonBlockingGenericDialog(
                    "FungiGrowthJ - Cut Applied"
                );

                addStepIndicator(nextDialog, 5, 6);

                nextDialog.addMessage(
                    "CUT APPLIED\n\n" +
                    "Cuts applied so far: " + cutCount + "\n\n" +
                    "If another connection still needs separating, draw another\n" +
                    "cut. There is no preset maximum number of cuts."
                );

                nextDialog.addChoice(
                    "Next action:",
                    [
                        "Draw another cut",
                        "Preview resulting regions",
                        "Undo last cut",
                        "Cancel correction"
                    ],
                    "Draw another cut"
                );

                nextDialog.setOKLabel("Continue");
                nextDialog.showDialog();

                if (nextDialog.wasCanceled()) {
                    reviewImage.setOverlay(null);
                    return null;
                }

                var nextAction = nextDialog.getNextChoice();

                if (nextAction == "Cancel correction") {
                    reviewImage.setOverlay(null);
                    return null;
                }

                if (nextAction == "Undo last cut") {
                    if (history.length > 0) {
                        currentShape = history.pop();
                        cutCount--;
                    }
                    previewRequested = false;
                    continue;
                }

                if (nextAction == "Preview resulting regions") {
                    previewRequested = true;
                } else {
                    previewRequested = false;
                    continue;
                }
            }

            if (previewRequested) {

                var fragments = currentShape.getRois();
                
                if (
                    fragments != null &&
                    fragments.length == 1
                ) {
                    IJ.showMessage(
                        "FungiGrowthJ - Cut Did Not Separate ROI",
                        "The current cut has not produced independent regions yet.\n\n" +
                        "This usually means the freehand line did not cross the\n" +
                        "entire connection. Add another cut, extend the cut farther\n" +
                        "across the connection, or undo the last cut."
                    );
                }
                
                if (fragments == null || fragments.length <= 0) {
                    IJ.showMessage(
                        "FungiGrowthJ - Cut / Trim ROI",
                        "The current cuts did not leave any valid ROI regions.\n" +
                        "Undo the last cut or cancel the correction."
                    );
                    continue;
                }
                
                // ----------------------------------------------------
                // Sequential cut-region review
                // ----------------------------------------------------
                //
                // Do not label every region on the image at once. With many
                // fragments the text and thick contours can hide small pieces.
                // Instead, show all regions with very thin neutral outlines and
                // highlight only the region currently being reviewed.
                // ----------------------------------------------------

                var decisions = [];
                for (var di = 0; di < fragments.length; di++) {
                    decisions.push("Keep as colony");
                }

                var regionIndex = 0;
                var returnToCuts = false;
                var cancelCutCorrection = false;

                while (
                    regionIndex >= 0 &&
                    regionIndex < fragments.length
                ) {

                    var regionOverlay =
                        new Overlay();

                    for (
                        var rp = 0;
                        rp < fragments.length;
                        rp++
                    ) {

                        var displayRoi;

                        try {
                            displayRoi =
                                fragments[rp].clone();
                        } catch (displayCloneError) {
                            displayRoi =
                                new ShapeRoi(
                                    fragments[rp]
                                );
                        }

                        if (
                            rp == regionIndex
                        ) {

                            displayRoi.setStrokeColor(
                                Color.RED
                            );

                            displayRoi.setStrokeWidth(
                                2.0
                            );

                        } else {

                            displayRoi.setStrokeColor(
                                Color.CYAN
                            );

                            displayRoi.setStrokeWidth(
                                0.75
                            );
                        }

                        regionOverlay.add(
                            displayRoi
                        );
                    }

                    reviewImage.deleteRoi();
                    reviewImage.setOverlay(
                        regionOverlay
                    );

                    // Also make the active fragment the current ROI. This makes
                    // tiny fragments much easier to locate without placing
                    // large text labels over the image.
                    reviewImage.setRoi(
                        fragments[regionIndex]
                    );

                    reviewImage.updateAndDraw();

                    if (
                        reviewImage.getWindow() != null
                    ) {
                        reviewImage.getWindow()
                            .toFront();
                    }

                    var regionMeasurement =
                        measureRoi(
                            reviewImage,
                            fragments[regionIndex],
                            centerX,
                            centerY
                        );

                    var regionBounds =
                        fragments[regionIndex]
                            .getBounds();

                    var regionDialog =
                        new NonBlockingGenericDialog(
                            "FungiGrowthJ - Review Cut Region " +
                            (regionIndex + 1) +
                            " of " +
                            fragments.length
                        );

                    addStepIndicator(
                        regionDialog,
                        5,
                        6
                    );

                    regionDialog.addMessage(
                        "REVIEW CUT REGION\\n\\n" +
                        "REGION " +
                        (regionIndex + 1) +
                        " OF " +
                        fragments.length +
                        "\\n\\n" +
                        "Only the active region is highlighted in RED.\\n" +
                        "All other regions have a thin cyan outline.\\n\\n" +
                        "Area: " +
                        regionMeasurement.area_px2.toFixed(2) +
                        " px^2\\n" +
                        "Bounding box: " +
                        regionBounds.width +
                        " × " +
                        regionBounds.height +
                        " px\\n\\n" +
                        "Keep is the safe default. Choose Discard only if this\\n" +
                        "fragment does not belong to any biological colony."
                    );

                    regionDialog.addChoice(
                        "Decision:",
                        [
                            "Keep as colony",
                            "Discard"
                        ],
                        decisions[regionIndex]
                    );

                    var navigationChoices;

                    if (
                        regionIndex <
                        fragments.length - 1
                    ) {

                        navigationChoices = [
                            "Save and next region",
                            "Previous region",
                            "Return to cuts",
                            "Cancel correction"
                        ];

                    } else {

                        navigationChoices = [
                            "Save and review summary",
                            "Previous region",
                            "Return to cuts",
                            "Cancel correction"
                        ];
                    }

                    regionDialog.addChoice(
                        "Next action:",
                        navigationChoices,
                        navigationChoices[0]
                    );

                    regionDialog.setOKLabel(
                        "Continue"
                    );

                    regionDialog.showDialog();

                    if (
                        regionDialog.wasCanceled()
                    ) {
                        cancelCutCorrection = true;
                        break;
                    }

                    decisions[regionIndex] =
                        regionDialog.getNextChoice();

                    var regionAction =
                        regionDialog.getNextChoice();

                    if (
                        regionAction ==
                        "Cancel correction"
                    ) {
                        cancelCutCorrection = true;
                        break;
                    }

                    if (
                        regionAction ==
                        "Return to cuts"
                    ) {
                        returnToCuts = true;
                        break;
                    }

                    if (
                        regionAction ==
                        "Previous region"
                    ) {

                        if (regionIndex > 0) {
                            regionIndex--;
                        }

                        continue;
                    }

                    regionIndex++;
                }

                reviewImage.deleteRoi();

                if (
                    cancelCutCorrection
                ) {
                    reviewImage.setOverlay(null);
                    return null;
                }

                if (
                    returnToCuts
                ) {
                    reviewImage.setOverlay(null);
                    previewRequested = false;
                    continue;
                }

                var keptCount = 0;
                var discardedCount = 0;

                for (
                    var dc = 0;
                    dc < decisions.length;
                    dc++
                ) {

                    if (
                        decisions[dc] ==
                        "Keep as colony"
                    ) {
                        keptCount++;
                    } else {
                        discardedCount++;
                    }
                }

                var summaryOverlay =
                    new Overlay();

                for (
                    var sp = 0;
                    sp < fragments.length;
                    sp++
                ) {

                    var summaryRoi;

                    try {
                        summaryRoi =
                            fragments[sp].clone();
                    } catch (summaryCloneError) {
                        summaryRoi =
                            new ShapeRoi(
                                fragments[sp]
                            );
                    }

                    summaryRoi.setStrokeWidth(
                        1.0
                    );

                    summaryRoi.setStrokeColor(
                        decisions[sp] ==
                        "Keep as colony"
                        ? Color.GREEN
                        : Color.GRAY
                    );

                    summaryOverlay.add(
                        summaryRoi
                    );
                }

                reviewImage.setOverlay(
                    summaryOverlay
                );

                var summaryDialog =
                    new NonBlockingGenericDialog(
                        "FungiGrowthJ - Cut Review Summary " +
                        parentCandidate.object_id
                    );

                addStepIndicator(
                    summaryDialog,
                    5,
                    6
                );

                summaryDialog.addMessage(
                    "CUT REVIEW SUMMARY\\n\\n" +
                    "Regions generated: " +
                    fragments.length +
                    "\\n" +
                    "Keep as colony: " +
                    keptCount +
                    "\\n" +
                    "Discard: " +
                    discardedCount +
                    "\\n\\n" +
                    "GREEN = keep\\n" +
                    "GRAY = discard"
                );

                summaryDialog.addChoice(
                    "Next action:",
                    [
                        "Accept result",
                        "Review regions again",
                        "Add another cut",
                        "Undo last cut",
                        "Cancel correction"
                    ],
                    "Accept result"
                );

                summaryDialog.setOKLabel(
                    "Continue"
                );

                summaryDialog.showDialog();

                if (
                    summaryDialog.wasCanceled()
                ) {
                    reviewImage.setOverlay(null);
                    return null;
                }

                var afterPreview =
                    summaryDialog.getNextChoice();

                if (
                    afterPreview ==
                    "Cancel correction"
                ) {
                    reviewImage.setOverlay(null);
                    return null;
                }

                if (
                    afterPreview ==
                    "Review regions again"
                ) {
                    reviewImage.setOverlay(null);
                    // Keep the geometry. Re-enter preview to review each
                    // fragment again from region 1.
                    previewRequested = true;
                    continue;
                }

                if (
                    afterPreview ==
                    "Add another cut"
                ) {
                    reviewImage.setOverlay(null);
                    previewRequested = false;
                    continue;
                }

                if (
                    afterPreview ==
                    "Undo last cut"
                ) {

                    reviewImage.setOverlay(null);

                    if (
                        history.length > 0
                    ) {
                        currentShape =
                            history.pop();

                        cutCount--;
                    }

                    previewRequested = false;
                    continue;
                }

                if (
                    keptCount <= 0
                ) {

                    IJ.showMessage(
                        "FungiGrowthJ - Cut / Trim ROI",
                        "At least one resulting region must be kept as a colony."
                    );

                    reviewImage.setOverlay(null);
                    previewRequested = true;
                    continue;
                }

                var children = [];
                var keptChildren = [];

                for (
                    var fc = 0;
                    fc < fragments.length;
                    fc++
                ) {

                    var keep =
                        decisions[fc] ==
                        "Keep as colony";

                    var fragmentCandidate =
                        createCutFragment(
                            fragments[fc],
                            parentCandidate,
                            keep
                        );

                    roiManager.addRoi(
                        fragmentCandidate.roi
                    );

                    fragmentCandidate.roi_manager_index =
                        roiManager.getCount() - 1;

                    roiManager.rename(
                        fragmentCandidate.roi_manager_index,
                        fragmentCandidate.object_id +
                        (
                            keep
                            ? "_cut"
                            : "_discarded"
                        )
                    );

                    children.push(
                        fragmentCandidate
                    );

                    if (keep) {
                        keptChildren.push(
                            fragmentCandidate
                        );
                    }
                }

                parentCandidate.final_type =
                    "ignore";

                parentCandidate.review_status =
                    "confirmed";

                parentCandidate.edited_manually =
                    true;

                parentCandidate.edit_operation =
                    "ROI_CUT_PARENT";

                parentCandidate.review_note =
                    "Cut/trim correction with " +
                    cutCount +
                    " cut(s); " +
                    keptChildren.length +
                    " colony region(s) kept; " +
                    discardedCount +
                    " fragment(s) discarded.";

                reviewImage.setOverlay(null);

                return {
                    all_children: children,
                    review_children: keptChildren
                };

                // If preview asked for another cut, the existing preview block
                // reaches continue. Reset this flag before the next iteration.
                previewRequested = false;
            }
        }
    }


    // ------------------------------------------------------------
    // HELPER FUNCTION — Replace an automatic ROI manually
    // ------------------------------------------------------------
    //
    // This is a general escape route for unusual colony morphologies.
    // The user draws/builds the biologically correct final area ROI.
    // Composite ShapeRoi selections are accepted, so holes can be
    // subtracted with Fiji selection tools before confirmation.
    //
    // The replacement ROI is then measured by the SAME measureRoi()
    // function used for automatic objects, preserving Batch output
    // variables and calibration.
    // ------------------------------------------------------------

    function captureManualReplacement(
        candidate
    ) {

        reviewImage.setOverlay(
            null
        );

        reviewImage.deleteRoi();

        reviewImage.getWindow()
            .toFront();

        while (true) {

            var manualDialog =
                new NonBlockingGenericDialog(
                    "FungiGrowthJ - Manual ROI: " +
                    candidate.object_id
                );

            addStepIndicator(
                manualDialog,
                5,
                6


            );



            manualDialog.addMessage(
                
                "REPLACE AUTOMATIC ROI MANUALLY\n\n" +
                "Draw or build the FINAL biological area occupied by this colony.\n\n" +
                "1. Use any CLOSED area-selection tool in Fiji.\n" +
                "2. Trace the colony boundary manually.\n" +
                "3. If the colony contains holes, subtract those areas using\n" +
                "   Fiji selection tools so the final selection is composite.\n" +
                "4. Leave the finished ROI active on the image.\n" +
                "5. Press Use manual ROI.\n\n" +
                "FungiGrowthJ will replace the automatic ROI and calculate\n" +
                "the normal Batch variables from this manual selection."
            );

            manualDialog.setOKLabel(
                "Use manual ROI"
            );

            manualDialog.showDialog();

            if (
                manualDialog.wasCanceled()
            ) {

                // Restore the original candidate visually.
                if (
                    candidate.roi != null
                ) {

                    reviewImage.setRoi(
                        candidate.roi
                    );

                    reviewImage.updateAndDraw();
                }

                return null;
            }

            var manualRoi =
                reviewImage.getRoi();

            if (
                manualRoi != null &&
                !manualRoi.isLine()
            ) {

                try {
                    manualRoi =
                        manualRoi.clone();
                } catch (ignoredCloneError) {}

                return manualRoi;
            }

            IJ.showMessage(
                "FungiGrowthJ - Manual ROI",
                "No valid closed area ROI was detected.\n\n" +
                "Draw the final colony area and try again."
            );
        }
    }


    function applyManualReplacement(
        candidate,
        managerIndex
    ) {

        var manualRoi =
            captureManualReplacement(
                candidate
            );

        if (
            manualRoi == null
        ) {
            return false;
        }

        candidate.roi =
            manualRoi;

        // Keep ROI Manager synchronized with the candidate whenever
        // possible. The candidate itself remains the scientific source
        // used for measurement/export even if a particular Fiji build
        // does not expose RoiManager.setRoi().
        try {

            roiManager.setRoi(
                manualRoi,
                managerIndex
            );

        } catch (setRoiError) {

            try {

                roiManager.select(
                    reviewImage,
                    managerIndex
                );

                reviewImage.setRoi(
                    manualRoi
                );

                roiManager.runCommand(
                    "Update"
                );

            } catch (updateRoiError) {}
        }

        var manualMeasurements =
            measureRoi(
                reviewImage,
                manualRoi,
                centerX,
                centerY
            );

        copyMeasurements(
            candidate,
            manualMeasurements
        );

        candidate.edited_manually =
            true;

        candidate.edit_operation =
            "ROI_MANUAL_REPLACE";

        candidate.review_flag =
            candidate.circularity <
            lowCircularityThreshold
            ? "low_circularity_after_manual_replace"
            : "";

        if (
            candidate.review_note == null ||
            String(
                candidate.review_note
            ).trim() == ""
        ) {

            candidate.review_note =
                "Automatic ROI replaced by a manually drawn ROI.";
        }

        reviewImage.setRoi(
            manualRoi
        );

        reviewImage.updateAndDraw();

        return true;
    }


    // ------------------------------------------------------------
    // STEP 15 — Guided review loop
    // ------------------------------------------------------------
    //
    // Default final type is "ignore", because the review begins with
    // the lowest-circularity objects.
    //
    // Available actions:
    // - Save and continue.
    // - Preview remaining objects.
    // - Finish review.
    //
    // Before finishing, the user sees every object that would remain
    // included. Unreviewed objects are marked with "?". The user can
    // return to the queue or jump directly to a visible object ID.
    //

    var reviewIndex = 0;
    var finishReview = false;

    while (reviewIndex < reviewQueue.length && !finishReview) {

        var current = reviewQueue[reviewIndex];
        var managerIndex = current.roi_manager_index;

        roiManager.select(reviewImage, managerIndex);
        reviewImage.setRoi(roiManager.getRoi(managerIndex));

        // ACTIVE has absolute visual priority over every biological/
        // review state. This guarantees that the object requiring a
        // decision is always red, even when it was created by Split ROI.
        updateDecisionPreview(
            current
        );

        reviewImage.setRoi(
            current.roi
        );

        reviewImage.getWindow().toFront();

        var dialog = new NonBlockingGenericDialog(
            "FungiGrowthJ - Step 5 of 6: Review " + current.object_id
        );

        // --------------------------------------------------------
        // Color legend
        // --------------------------------------------------------
        // The words use the same visual language as the image overlay.
        // Yellow is intentionally rendered as a darker gold so it remains
        // legible against Fiji's light-gray dialog background.
        var legendPanel =
            new Panel(
                new FlowLayout(
                    FlowLayout.LEFT,
                    3,
                    0
                )
            );

        var legendTitle =
            new Label(
                "COLOR LEGEND:"
            );

        legendTitle.setFont(
            new AwtFont(
                "SansSerif",
                AwtFont.BOLD,
                12
            )
        );

        legendPanel.add(
            legendTitle
        );

        function addLegendItem(
            panel,
            word,
            description,
            color
        ) {

            var wordLabel =
                new Label(
                    word
                );

            wordLabel.setForeground(
                color
            );

            wordLabel.setFont(
                new AwtFont(
                    "SansSerif",
                    AwtFont.BOLD,
                    12
                )
            );

            panel.add(
                wordLabel
            );

            panel.add(
                new Label(
                    "= " +
                    description +
                    "  |"
                )
            );
        }

        addLegendItem(
            legendPanel,
            "RED",
            "active",
            new AwtColor(190, 0, 0)
        );

        addLegendItem(
            legendPanel,
            "YELLOW",
            "pending",
            new AwtColor(170, 125, 0)
        );

        addLegendItem(
            legendPanel,
            "GREEN",
            "accepted",
            new AwtColor(0, 125, 0)
        );

        addLegendItem(
            legendPanel,
            "GRAY",
            "ignored",
            new AwtColor(95, 95, 95)
        );

        addLegendItem(
            legendPanel,
            "CYAN",
            "new split",
            new AwtColor(0, 125, 145)
        );

        dialog.addPanel(
            legendPanel
        );


        // --------------------------------------------------------
        // Object identity and measurements
        // --------------------------------------------------------

        addStepIndicator(
            dialog,
            5,
            6


        );



        dialog.addMessage(
            
            "Object: " +
            current.object_id +
            "     Review position: " +
            (reviewIndex + 1) +
            " of " +
            reviewQueue.length +
            "\n\n" +
            "MEASUREMENTS\n" +
            "Circularity: " +
            current.circularity.toFixed(3) +
            "\n" +
            "Area: " +
            current.area_px2.toFixed(1) +
            " px^2\n" +
            "Perimeter: " +
            current.perimeter_px.toFixed(1) +
            " px\n" +
            "Review flag: " +
            (current.review_flag || "none") +
            "\nDetection source: " +
            (
                current.detection_source ==
                "very_small_pass"
                ? "VERY SMALL / POINT-LIKE PASS"
                : "NORMAL"
            )
        );


        // --------------------------------------------------------
        // Classification — primary decision
        // --------------------------------------------------------

        var proposedDisplay =
            current.proposed_type ==
            "central"
            ? "CENTRAL"
            : "SATELLITE";

        var keepAutomaticLabel =
            "Keep automatic proposal (" +
            proposedDisplay +
            ")";

        var classificationPanel =
            new Panel(
                new FlowLayout(
                    FlowLayout.LEFT,
                    5,
                    0
                )
            );

        var automaticProposalTitle =
            new Label(
                "Automatic proposal:"
            );

        automaticProposalTitle.setFont(
            new AwtFont(
                "SansSerif",
                AwtFont.BOLD,
                12
            )
        );

        classificationPanel.add(
            automaticProposalTitle
        );

        var automaticProposalValue =
            new Label(
                proposedDisplay
            );

        automaticProposalValue.setFont(
            new AwtFont(
                "SansSerif",
                AwtFont.BOLD,
                14
            )
        );

        classificationPanel.add(
            automaticProposalValue
        );

        dialog.addMessage(
            "\nCLASSIFICATION"
        );

        dialog.addPanel(
            classificationPanel
        );

        dialog.addChoice(
            "Choose final classification:",
            [
                keepAutomaticLabel,
                "ignore",
                "satellite",
                "central",
                "defer"
            ],
            keepAutomaticLabel
        );

        dialog.addMessage(
            "If the automatic proposal is correct, simply press Save and continue."
        );


        // --------------------------------------------------------
        // Optional editing and navigation
        // --------------------------------------------------------

        dialog.addCheckbox(
            "ROI was edited and updated in ROI Manager",
            false
        );

        dialog.addStringField(
            "Review note:",
            "",
            35
        );

        dialog.addChoice(
            "Next action:",
            [
                "Save and continue",
                "Edit/review this object again",
                "Cut / trim automatic ROI",
                "Replace with manual ROI",
                "Split ROI into multiple colonies",
                "Preview remaining",
                "Finish review"
            ],
            "Save and continue"
        );

        dialog.addMessage(
            "Need to modify the contour?\n" +
            "Edit it with Fiji tools and Update it in ROI Manager, then\n" +
            "check the edited-ROI box above.\n\n" +
            "Prefer Cut / trim when the outer automatic contour is correct.\n" +
            "Use manual replacement/split only when a larger reconstruction is needed."
        );

        dialog.showDialog();

        if (dialog.wasCanceled()) {
            current.final_type = "defer";
            current.review_status = "deferred";
            current.review_note = "Review canceled.";
            reviewIndex++;
            continue;
        }

        var classificationChoice =
            dialog.getNextChoice();

        if (
            classificationChoice ==
            keepAutomaticLabel
        ) {

            current.final_type =
                current.proposed_type ==
                "central"
                ? "central"
                : "satellite";

            current.review_status =
                "auto_accepted";

        } else {

            current.final_type =
                classificationChoice;

            current.review_status =
                current.final_type ==
                "defer"
                ? "deferred"
                : "confirmed";
        }

        current.edited_manually =
            dialog.getNextBoolean();
        current.review_note = dialog.getNextString();
        var nextAction = dialog.getNextChoice();

        // Preserve AUTO_ACC when the user keeps the automatic proposal.
        // Manual classifications are recorded as confirmed.
        if (
            classificationChoice !=
            keepAutomaticLabel
        ) {

            current.review_status =
                current.final_type == "defer"
                ? "deferred"
                : "confirmed";
        }

        if (current.edited_manually) {

            var updatedRoi = roiManager.getRoi(managerIndex);

            if (updatedRoi != null) {

                current.roi = updatedRoi;

                var updated = measureRoi(
                    reviewImage,
                    updatedRoi,
                    centerX,
                    centerY
                );

                copyMeasurements(current, updated);

                current.review_flag =
                    current.circularity < lowCircularityThreshold
                    ? "low_circularity_after_edit"
                    : "";

                current.edit_operation =
                    "ROI_EDIT";
            }
        }

        if (
            nextAction ==
            "Cut / trim automatic ROI"
        ) {

            reviewImage.setOverlay(null);
            if (current.roi != null) {
                reviewImage.setRoi(current.roi);
                reviewImage.updateAndDraw();
            }

            var cutResult = cutTrimCandidate(current);

            if (cutResult == null) {
                current.final_type = "unreviewed";
                current.review_status = "pending";
                current.edited_manually = false;
                current.edit_operation = "NONE";
                updateDecisionPreview(current);
                continue;
            }

            for (var cutAll = 0;
                 cutAll < cutResult.all_children.length;
                 cutAll++) {
                candidates.push(cutResult.all_children[cutAll]);
            }

            for (var cutQueue = 0;
                 cutQueue < cutResult.review_children.length;
                 cutQueue++) {
                reviewQueue.splice(
                    reviewIndex + 1 + cutQueue,
                    0,
                    cutResult.review_children[cutQueue]
                );
            }

            reviewImage.deleteRoi();
            updateDecisionPreview();
            reviewIndex++;
            continue;
        }


        if (
            nextAction ==
            "Replace with manual ROI"
        ) {

            var manualReplacementApplied =
                applyManualReplacement(
                    current,
                    managerIndex
                );

            if (
                !manualReplacementApplied
            ) {

                // Manual replacement was canceled. Reopen the same
                // review object without changing its previous ROI.
                current.final_type =
                    "unreviewed";

                current.review_status =
                    "pending";

                current.edited_manually =
                    false;

                current.edit_operation =
                    "NONE";

                updateDecisionPreview(
                    current
                );

                continue;
            }

            // Reopen the same object after replacement so the user can
            // visually inspect the new ROI and confirm/classify it.
            current.final_type =
                "unreviewed";

            current.review_status =
                "pending";

            updateDecisionPreview(
                current
            );

            continue;
        }


        if (nextAction ==
            "Split ROI into multiple colonies") {

            // Restore the currently reviewed object before opening
            // a new split wizard. Previous split previews or daughter
            // ROIs must not remain active.
            reviewImage.setOverlay(
                null
            );

            if (current.roi_manager_index >= 0) {

                roiManager.select(
                    reviewImage,
                    current.roi_manager_index
                );
            }

            if (current.roi != null) {

                reviewImage.setRoi(
                    current.roi
                );
            }

            reviewImage.updateAndDraw();

            var splitChildren = null;
            var splitOperationCanceled = false;

            try {
                splitChildren =
                    splitCandidate(
                        current
                    );
            } catch (splitCancelError) {
                var splitCancelText = String(splitCancelError);
                if (
                    splitCancelText.indexOf("Macro canceled") >= 0 ||
                    splitCancelText.indexOf("canceled") >= 0 ||
                    splitCancelText.indexOf("canceled by user") >= 0
                ) {
                    splitOperationCanceled = true;
                    IJ.log(
                        "FungiGrowthJ: secondary Split ROI operation canceled; preserving current review state."
                    );
                } else {
                    throw splitCancelError;
                }
            }

            if (splitChildren == null || splitOperationCanceled) {

                // A secondary split operation was canceled. This is NOT an
                // image-analysis failure. Preserve all review work already
                // completed and simply reopen the same review object.
                current.final_type =
                    "unreviewed";

                current.review_status =
                    "pending";

                current.edited_manually =
                    false;

                current.edit_operation =
                    "NONE";

                updateDecisionPreview(
                    current
                );

                continue;
            }

            // Add every daughter to the global candidate list.
            for (var newChildIndex = 0;
                 newChildIndex < splitChildren.length;
                 newChildIndex++) {

                candidates.push(
                    splitChildren[
                        newChildIndex
                    ]
                );
            }

            // Insert daughters immediately after the parent so
            // each one is reviewed next.
            //
            // IMPORTANT:
            // Do not use Array.prototype here because this script
            // also imports java.lang.reflect.Array for pixel buffers.
            // That Java class shadows JavaScript's global Array in
            // Nashorn. Insert the daughters directly into reviewQueue.
            for (var queueChild = 0;
                 queueChild < splitChildren.length;
                 queueChild++) {

                reviewQueue.splice(
                    reviewIndex +
                    1 +
                    queueChild,
                    0,
                    splitChildren[
                        queueChild
                    ]
                );
            }

            // Reset all temporary split visuals before returning
            // to the normal review queue.
            reviewImage.deleteRoi();

            updateDecisionPreview();

            reviewIndex++;
            continue;
        }


        if (nextAction == "Edit/review this object again") {

            // Keep the same object selected and reopen its dialog.
            // ACTIVE remains red while the user edits/rechecks it.
            updateDecisionPreview(
                current
            );
            continue;
        }

        reviewIndex++;

        if (nextAction == "Save and continue") {
            continue;
        }

        updateDecisionPreview();

        var counts = countReviewStates();

        var previewDialog = new NonBlockingGenericDialog(
            "FungiGrowthJ - Review Preview"
        );

        addStepIndicator(
            previewDialog,
            5,
            6


        );



        previewDialog.addMessage(
            
            "Review the image before finishing.\n\n" +
            "Confirmed included objects: " + counts.confirmed + "\n" +
            "Ignored objects: " + counts.ignored + "\n" +
            "Deferred objects: " + counts.deferred + "\n" +
            "Unreviewed objects shown with ?: " +
            counts.unreviewed + "\n\n" +
            "Unreviewed objects will be accepted using their\n" +
            "automatic proposed type if you finish now."
        );

        previewDialog.addChoice(
            "Action:",
            [
                "Continue reviewing",
                "Finish and accept remaining proposals"
            ],
            nextAction == "Finish review"
                ? "Finish and accept remaining proposals"
                : "Continue reviewing"
        );

        previewDialog.addStringField(
            "Jump to object ID (optional):",
            "",
            12
        );

        previewDialog.addMessage(
            "Enter an object ID visible in the preview, such as OBJ12,\n" +
            "to continue the review from that object."
        );

        previewDialog.showDialog();

        if (previewDialog.wasCanceled()) {
            reviewImage.setOverlay(null);
            continue;
        }

        var previewAction = previewDialog.getNextChoice();
        var jumpObjectId =
            previewDialog.getNextString().trim();

        if (previewAction ==
            "Finish and accept remaining proposals") {

            finishReview = true;
            break;
        }

        if (jumpObjectId != "") {

            var jumpIndex = -1;

            for (var q = 0; q < reviewQueue.length; q++) {
                if (reviewQueue[q].object_id == jumpObjectId) {
                    jumpIndex = q;
                    break;
                }
            }

            if (jumpIndex >= 0) {
                reviewIndex = jumpIndex;
            } else {
                IJ.showMessage(
                    "FungiGrowthJ",
                    "Object ID '" + jumpObjectId +
                    "' was not found in the review queue."
                );
            }
        }

        reviewImage.setOverlay(null);
    }


    // ------------------------------------------------------------
    // STEP 16 — Accept remaining automatic proposals after Finish
    // ------------------------------------------------------------
    //
    // This happens only after the user has inspected the complete
    // preview and explicitly confirmed the finish action.
    //

    if (finishReview) {

        for (var autoIndex = 0;
             autoIndex < candidates.length;
             autoIndex++) {

            var autoCandidate = candidates[autoIndex];

            if (autoCandidate.final_type != "unreviewed") {
                continue;
            }

            if (
                autoCandidate.detection_source ==
                "very_small_pass"
            ) {
                autoCandidate.final_type =
                    "defer";

                autoCandidate.review_status =
                    "deferred";

                autoCandidate.review_note =
                    "Very-small candidate was not explicitly classified; deferred for safety.";

                continue;
            }

            autoCandidate.final_type =
                autoCandidate.proposed_type == "central"
                ? "central"
                : "satellite";

            autoCandidate.review_status =
                "auto_accepted_after_preview";

            autoCandidate.review_note =
                "Accepted from automatic proposal after final preview.";
        }
    }

    // ------------------------------------------------------------
    // STEP 17 — Synchronize ROI Manager names with final decisions
    // ------------------------------------------------------------
    //
    // ROIs remain in the ROI Manager by default because they are the
    // editable and auditable record of every detected object.
    //
    // Each ROI is renamed using:
    //     object_id_finalType
    //
    // Example:
    //     C1_central
    //     OBJ4_satellite
    //     OBJ7_ignore
    //
    // If the user explicitly requested removal of ignored ROIs,
    // those entries are deleted in reverse index order to avoid
    // shifting later ROI Manager indexes.
    //

    for (var renameIndex = 0;
         renameIndex < candidates.length;
         renameIndex++) {

        var renameCandidate = candidates[renameIndex];
        var roiName =
            renameCandidate.object_id + "_" +
            renameCandidate.final_type;

        roiManager.rename(
            renameCandidate.roi_manager_index,
            roiName
        );
    }

    if (removeIgnoredRois) {

        var ignoredManagerIndexes = [];

        for (var ignoredIndex = 0;
             ignoredIndex < candidates.length;
             ignoredIndex++) {

            if (candidates[ignoredIndex].final_type == "ignore") {
                ignoredManagerIndexes.push(
                    candidates[ignoredIndex].roi_manager_index
                );
            }
        }

        ignoredManagerIndexes.sort(function(a, b) {
            return b - a;
        });

        for (var deleteIndex = 0;
             deleteIndex < ignoredManagerIndexes.length;
             deleteIndex++) {

            roiManager.select(
                ignoredManagerIndexes[deleteIndex]
            );

            roiManager.runCommand("Delete");
        }
    }

    reviewImage.deleteRoi();
    updateDecisionPreview();

    var centralCount = 0;
    for (var v = 0; v < candidates.length; v++) {
        if (candidates[v].final_type == "central") centralCount++;
    }

    // ------------------------------------------------------------
    // CENTRAL-COLONY SPATIAL METRICS
    // ------------------------------------------------------------

    function getBoundaryPolygon(roi) {

        if (roi == null) {
            return null;
        }

        try {

            var interpolated =
                roi.getInterpolatedPolygon(
                    1.0,
                    false
                );

            if (
                interpolated != null &&
                interpolated.npoints > 0
            ) {
                return interpolated;
            }

        } catch (interpolationError) {
            // Fallback below.
        }

        try {

            return roi.getFloatPolygon();

        } catch (polygonError) {

            return null;
        }
    }


    function minimumBoundaryDistanceCalibrated(
        roiA,
        roiB,
        pixelWidth,
        pixelHeight
    ) {

        var polyA =
            getBoundaryPolygon(
                roiA
            );

        var polyB =
            getBoundaryPolygon(
                roiB
            );

        if (
            polyA == null ||
            polyB == null ||
            polyA.npoints <= 0 ||
            polyB.npoints <= 0
        ) {

            return NaN;
        }

        var minimumSquared =
            Number.POSITIVE_INFINITY;

        for (var a = 0;
             a < polyA.npoints;
             a++) {

            var ax =
                polyA.xpoints[a];

            var ay =
                polyA.ypoints[a];

            for (var b = 0;
                 b < polyB.npoints;
                 b++) {

                var dx =
                    (
                        ax -
                        polyB.xpoints[b]
                    ) *
                    pixelWidth;

                var dy =
                    (
                        ay -
                        polyB.ypoints[b]
                    ) *
                    pixelHeight;

                var squared =
                    dx * dx +
                    dy * dy;

                if (
                    squared <
                    minimumSquared
                ) {

                    minimumSquared =
                        squared;

                    if (
                        minimumSquared == 0
                    ) {
                        return 0.0;
                    }
                }
            }
        }

        return Math.sqrt(
            minimumSquared
        );
    }


    function centralReferenceCandidate() {

        var centralCandidate =
            null;

        var count = 0;

        for (var i = 0;
             i < candidates.length;
             i++) {

            if (
                candidates[i]
                    .final_type ==
                "central"
            ) {

                centralCandidate =
                    candidates[i];

                count++;
            }
        }

        return {
            candidate:
                centralCandidate,

            count:
                count
        };
    }


    // ------------------------------------------------------------
    // Compact codes used in CSV outputs
    // ------------------------------------------------------------

    function typeCode(value) {

        if (value == "central") {
            return "CEN";
        }

        if (value == "satellite" ||
            value == "candidate_satellite") {
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
    }

    function reviewStatusCode(value) {

        if (value == "confirmed") {
            return "MAN_CONF";
        }

        if (
            value ==
            "auto_accepted_after_preview" ||
            value ==
            "auto_accepted"
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
    }

    function reviewFlagCode(value) {

        if (value == null ||
            value == "") {
            return "";
        }

        return String(value)
            .replace(
                /very_small_candidate/g,
                "SMALL"
            )
            .replace(
                /low_circularity_after_manual_replace/g,
                "LOW_CIRC_MANUAL"
            )
            .replace(
                /low_circularity_after_edit/g,
                "LOW_CIRC_EDIT"
            )
            .replace(
                /low_circularity_after_cut/g,
                "LOW_CIRC_CUT"
            )
            .replace(
                /low_circularity_after_split/g,
                "LOW_CIRC_SPLIT"
            )
            .replace(
                /low_circularity/g,
                "LOW_CIRC"
            )
            .replace(
                /near_agar_boundary/g,
                "NEAR_EDGE"
            );
    }

    function reviewNoteCode(row) {

        if (row.edit_operation == "ROI_CUT_PARENT") {
            return "ROI_CUT_PARENT";
        }

        if (row.edit_operation == "ROI_CUT_DISCARD") {
            return "ROI_CUT_DISCARD";
        }

        if (row.edit_operation == "ROI_CUT") {
            return "ROI_CUT";
        }

        if (row.edit_operation ==
            "ROI_SPLIT_PARENT") {
            return "ROI_SPLIT_PARENT";
        }

        if (row.edit_operation ==
            "ROI_SPLIT") {
            return "ROI_SPLIT";
        }

        if (row.final_type == "ignore") {
            return "IGNORED";
        }

        if (
            row.edit_operation ==
            "ROI_MANUAL_REPLACE"
        ) {
            return "ROI_MANUAL_REPLACE";
        }

        if (row.edit_operation ==
            "ROI_EDIT" ||
            row.edited_manually) {
            return "ROI_EDIT";
        }

        if (row.review_status ==
            "auto_accepted_after_preview") {
            return "AUTO_ACC";
        }

        if (row.review_status ==
            "confirmed") {
            return "MAN_CONF";
        }

        if (row.review_status ==
            "deferred") {
            return "DEFERRED";
        }

        return "";
    }

    var centralReference =
        centralReferenceCandidate();

    var centralCandidateForDistances =
        centralReference.count == 1
        ? centralReference.candidate
        : null;

    var finalRows = candidates.slice(0);
    finalRows.sort(function(a, b) {
        return a.circularity - b.circularity;
    });

    var results = new ResultsTable();

    for (var o = 0;
         o < finalRows.length;
         o++) {

        var row =
            finalRows[o];

        var currentCalibration =
            sourceImage.getCalibration();

        var unitPerPixelX =
            currentCalibration.pixelWidth;

        var unitPerPixelY =
            currentCalibration.pixelHeight;

        var meanUnitPerPixel =
            (
                unitPerPixelX +
                unitPerPixelY
            ) / 2.0;

        var areaCalibrated =
            row.area_px2 *
            unitPerPixelX *
            unitPerPixelY;

        var perimeterCalibrated =
            row.perimeter_px *
            meanUnitPerPixel;

        var distanceCalibrated =
            row.distance_to_center_px *
            meanUnitPerPixel;

        var equivalentRadius =
            Math.sqrt(
                areaCalibrated /
                Math.PI
            );

        var equivalentDiameter =
            2.0 *
            equivalentRadius;

        var majorAxisCalibrated =
            row.major_axis_px *
            meanUnitPerPixel;

        var minorAxisCalibrated =
            row.minor_axis_px *
            meanUnitPerPixel;

        var majorRadiusCalibrated =
            majorAxisCalibrated /
            2.0;

        var minorRadiusCalibrated =
            minorAxisCalibrated /
            2.0;

        var feretMaxCalibrated =
            row.feret_max_px *
            meanUnitPerPixel;

        var feretMinCalibrated =
            row.feret_min_px *
            meanUnitPerPixel;

        var convexHullAreaCalibrated =
            row.convex_hull_area_px2 *
            unitPerPixelX *
            unitPerPixelY;

        var convexHullPerimeterCalibrated =
            row.convex_hull_perimeter_px *
            meanUnitPerPixel;

        var centroidXCalibrated =
            row.centroid_x_px *
            unitPerPixelX;

        var centroidYCalibrated =
            row.centroid_y_px *
            unitPerPixelY;

        var agarAreaCalibrated =
            Math.PI *
            radiusXUnits *
            radiusYUnits;

        var plateOccupancyPct =
            agarAreaCalibrated > 0
            ? (
                areaCalibrated /
                agarAreaCalibrated
              ) * 100.0
            : NaN;

        var distanceToCentralCentroid =
            NaN;

        var distanceToCentralEdge =
            NaN;

        var inoculationOriginXCalibrated =
            inoculationOriginRecorded
            ? inoculationOriginXpx *
              unitPerPixelX
            : NaN;

        var inoculationOriginYCalibrated =
            inoculationOriginRecorded
            ? inoculationOriginYpx *
              unitPerPixelY
            : NaN;

        var distanceToInoculationOrigin =
            NaN;

        var angleFromInoculationOriginDeg =
            NaN;

        if (
            inoculationOriginRecorded &&
            (
                row.final_type == "central" ||
                row.final_type == "satellite"
            )
        ) {

            var originDx =
                (
                    row.centroid_x_px -
                    inoculationOriginXpx
                ) *
                unitPerPixelX;

            var originDy =
                (
                    row.centroid_y_px -
                    inoculationOriginYpx
                ) *
                unitPerPixelY;

            distanceToInoculationOrigin =
                Math.sqrt(
                    originDx *
                    originDx +
                    originDy *
                    originDy
                );

            // Cartesian-style orientation:
            // 0 deg = image right, 90 deg = image up.
            angleFromInoculationOriginDeg =
                Math.atan2(
                    -originDy,
                    originDx
                ) *
                180.0 /
                Math.PI;

            if (
                angleFromInoculationOriginDeg <
                0
            ) {

                angleFromInoculationOriginDeg +=
                    360.0;
            }
        }

        if (
            centralCandidateForDistances != null
        ) {

            if (
                row.final_type ==
                "central"
            ) {

                distanceToCentralCentroid =
                    0.0;

                distanceToCentralEdge =
                    0.0;

            } else if (
                row.final_type ==
                "satellite"
            ) {

                var centralDxCalibrated =
                    (
                        row.centroid_x_px -
                        centralCandidateForDistances
                            .centroid_x_px
                    ) *
                    unitPerPixelX;

                var centralDyCalibrated =
                    (
                        row.centroid_y_px -
                        centralCandidateForDistances
                            .centroid_y_px
                    ) *
                    unitPerPixelY;

                distanceToCentralCentroid =
                    Math.sqrt(
                        centralDxCalibrated *
                        centralDxCalibrated +
                        centralDyCalibrated *
                        centralDyCalibrated
                    );

                distanceToCentralEdge =
                    minimumBoundaryDistanceCalibrated(
                        row.roi,
                        centralCandidateForDistances.roi,
                        unitPerPixelX,
                        unitPerPixelY
                    );
            }
        }

        results.incrementCounter();

        // ========================================================
        // IDENTIFICATION AND SCIENTIFIC RESULTS
        // ========================================================

        results.addValue(
            "experiment",
            fgExperiment
        );

        results.addValue(
            "strain_id",
            fgStrainId
        );

        results.addValue(
            "replicate_id",
            fgReplicateId
        );

        results.addValue(
            "date_raw",
            fgDateRaw
        );

        results.addValue(
            "date",
            fgDateIso
        );

        results.addValue(
            "image_file",
            sourceImage.getTitle()
        );

        results.addValue(
            "analysis_revision",
            fgAnalysisRevision
        );

        results.addValue(
            "colony_id",
            row.object_id
        );

        results.addValue(
            "parent_object_id",
            row.parent_object_id || ""
        );

        results.addValue(
            "edit_operation",
            row.edit_operation || "NONE"
        );

        results.addValue(
            "candidate_detection_source",
            row.detection_source || "normal_pass"
        );

        results.addValue(
            "roi_source",
            row.edit_operation == "ROI_MANUAL_REPLACE"
                ? "manual"
                : (
                    row.edit_operation == "ROI_SPLIT"
                    ? "manual_split"
                    : (
                        row.edit_operation == "ROI_CUT" ||
                        row.edit_operation == "ROI_CUT_DISCARD"
                        ? "automatic_cut"
                        : (
                            row.edit_operation == "ROI_EDIT"
                            ? "automatic_edited"
                            : "automatic"
                        )
                    )
                )
        );

        results.addValue(
            "final_type",
            typeCode(
                row.final_type
            )
        );

        results.addValue(
            "area_" + scaleUnit + "2",
            areaCalibrated
        );

        results.addValue(
            "perimeter_" + scaleUnit,
            perimeterCalibrated
        );

        results.addValue(
            "equivalent_radius_" + scaleUnit,
            equivalentRadius
        );

        results.addValue(
            "equivalent_diameter_" + scaleUnit,
            equivalentDiameter
        );

        results.addValue(
            "major_axis_" + scaleUnit,
            majorAxisCalibrated
        );

        results.addValue(
            "minor_axis_" + scaleUnit,
            minorAxisCalibrated
        );

        results.addValue(
            "major_radius_" + scaleUnit,
            majorRadiusCalibrated
        );

        results.addValue(
            "minor_radius_" + scaleUnit,
            minorRadiusCalibrated
        );

        results.addValue(
            "feret_max_" + scaleUnit,
            feretMaxCalibrated
        );

        results.addValue(
            "feret_min_" + scaleUnit,
            feretMinCalibrated
        );

        results.addValue(
            "convex_hull_area_" + scaleUnit + "2",
            convexHullAreaCalibrated
        );

        results.addValue(
            "convex_hull_perimeter_" + scaleUnit,
            convexHullPerimeterCalibrated
        );

        results.addValue(
            "distance_to_plate_center_" + scaleUnit,
            distanceCalibrated
        );

        results.addValue(
            "distance_to_central_centroid_" + scaleUnit,
            distanceToCentralCentroid
        );

        results.addValue(
            "distance_to_central_edge_" + scaleUnit,
            distanceToCentralEdge
        );

        results.addValue(
            "inoculation_origin_x_" + scaleUnit,
            inoculationOriginXCalibrated
        );

        results.addValue(
            "inoculation_origin_y_" + scaleUnit,
            inoculationOriginYCalibrated
        );

        results.addValue(
            "distance_to_inoculation_origin_" + scaleUnit,
            distanceToInoculationOrigin
        );

        results.addValue(
            "angle_from_inoculation_origin_deg",
            angleFromInoculationOriginDeg
        );

        results.addValue(
            "centroid_x_" + scaleUnit,
            centroidXCalibrated
        );

        results.addValue(
            "centroid_y_" + scaleUnit,
            centroidYCalibrated
        );

        results.addValue(
            "plate_occupancy_pct",
            plateOccupancyPct
        );

        results.addValue(
            "circularity",
            row.circularity
        );

        results.addValue(
            "aspect_ratio",
            row.aspect_ratio
        );

        results.addValue(
            "eccentricity",
            row.eccentricity
        );

        results.addValue(
            "solidity",
            row.solidity
        );

        results.addValue(
            "convexity",
            row.convexity
        );

        results.addValue(
            "ellipse_angle_deg",
            row.ellipse_angle_deg
        );

        results.addValue(
            "feret_angle_deg",
            row.feret_angle_deg
        );

        // ========================================================
        // REVIEW AND DATA-QUALITY FIELDS
        // ========================================================

        results.addValue(
            "proposed_type",
            typeCode(
                row.proposed_type
            )
        );

        results.addValue(
            "review_status",
            reviewStatusCode(
                row.review_status
            )
        );

        results.addValue(
            "review_flag",
            reviewFlagCode(
                row.review_flag
            )
        );

        results.addValue(
            "edited_manually",
            row.edited_manually
                ? "Y"
                : "N"
        );

        results.addValue(
            "review_code",
            reviewNoteCode(row)
        );

        // Preserve a free-text note only when the user typed one.
        results.addValue(
            "review_note",
            row.review_note || ""
        );

        // ========================================================
        // RAW PIXEL MEASUREMENTS
        // ========================================================

        results.addValue(
            "area_px2",
            row.area_px2
        );

        results.addValue(
            "perimeter_px",
            row.perimeter_px
        );

        results.addValue(
            "distance_to_center_px",
            row.distance_to_center_px
        );

        results.addValue(
            "centroid_x_px",
            row.centroid_x_px
        );

        results.addValue(
            "centroid_y_px",
            row.centroid_y_px
        );

        results.addValue(
            "inoculation_origin_x_px",
            inoculationOriginRecorded
            ? inoculationOriginXpx
            : NaN
        );

        results.addValue(
            "inoculation_origin_y_px",
            inoculationOriginRecorded
            ? inoculationOriginYpx
            : NaN
        );

        results.addValue(
            "inoculation_origin_recorded",
            inoculationOriginRecorded
            ? "Y"
            : "N"
        );

        results.addValue(
            "major_axis_px",
            row.major_axis_px
        );

        results.addValue(
            "minor_axis_px",
            row.minor_axis_px
        );

        results.addValue(
            "feret_max_px",
            row.feret_max_px
        );

        results.addValue(
            "feret_min_px",
            row.feret_min_px
        );

        results.addValue(
            "convex_hull_area_px2",
            row.convex_hull_area_px2
        );

        results.addValue(
            "convex_hull_perimeter_px",
            row.convex_hull_perimeter_px
        );

        // ========================================================
        // CALIBRATION AND PROCESS METADATA
        // ========================================================

        results.addValue(
            "scale_method",
            "LINE_REF"
        );

        results.addValue(
            "scale_unit",
            scaleUnit
        );

        results.addValue(
            "agar_area_" + scaleUnit + "2",
            agarAreaCalibrated
        );

        results.addValue(
            "agar_roi_width_px",
            acceptedBounds.width
        );

        results.addValue(
            "agar_roi_height_px",
            acceptedBounds.height
        );

        results.addValue(
            "agar_roi_width_" + scaleUnit,
            acceptedBounds.width *
            calibration.pixelWidth
        );

        results.addValue(
            "agar_roi_height_" + scaleUnit,
            acceptedBounds.height *
            calibration.pixelHeight
        );

        results.addValue(
            "known_distance",
            knownDistance
        );

        results.addValue(
            "line_length_px",
            lineLengthPixels
        );

        results.addValue(
            "pixels_per_unit",
            pixelsPerUnit
        );

        results.addValue(
            "agar_roi_method",
            agarRoiSource == "manual"
                ? "MANUAL_OVAL"
                : (
                    agarRoiSource == "replicate_reference" ||
                    agarRoiSource == "replicate_reference_resized"
                    ? "REPLICATE_REFERENCE_OVAL"
                    : "RGB_SEEDED"
                )
        );

        results.addValue(
            "agar_roi_source",
            agarRoiSource
        );

        results.addValue(
            "agar_roi_manual_edit",
            manuallyAdjusted
                ? "Y"
                : "N"
        );

        results.addValue(
            "agar_roi_policy",
            fgAgarRoiPolicy
        );

        results.addValue(
            "agar_reference_used",
            agarReferenceUsed ? "Y" : "N"
        );

        results.addValue(
            "agar_reference_established",
            agarReferenceEstablished ? "Y" : "N"
        );

        results.addValue(
            "agar_reference_resize_allowed",
            agarReferenceResizeAllowed ? "Y" : "N"
        );

        results.addValue(
            "agar_reference_moved",
            agarReferenceMoved ? "Y" : "N"
        );

        results.addValue(
            "agar_reference_resized",
            agarReferenceResized ? "Y" : "N"
        );

        results.addValue(
            "agar_reference_source_date",
            agarReferenceSourceDate
        );

        results.addValue(
            "agar_reference_scale_unit",
            scaleUnit
        );

        results.addValue(
            "agar_reference_width_physical",
            acceptedBounds.width * calibration.pixelWidth
        );

        results.addValue(
            "agar_reference_height_physical",
            acceptedBounds.height * calibration.pixelHeight
        );

        results.addValue(
            "illumination_handling",
            illuminationHandling
        );

        results.addValue(
            "illumination_metric",
            illuminationMetric
        );

        results.addValue(
            "illumination_background_sigma_px",
            illuminationBackgroundSigma
        );

        results.addValue(
            "threshold_method",
            "IJ_ISODATA"
        );

        results.addValue(
            "threshold_value",
            thresholdValue
        );

        results.addValue(
            "very_small_detection_enabled",
            detectVerySmallCandidates
                ? "Y"
                : "N"
        );

        results.addValue(
            "very_small_min_area_px2",
            detectVerySmallCandidates
                ? minimumVerySmallArea
                : 0
        );

        results.addValue(
            "very_small_candidate_count",
            verySmallCandidateCount
        );

        results.addValue(
            "manual_dark_artifact_cleanup",
            manualDarkArtifactCleanupApplied
                ? "Y"
                : "N"
        );

        results.addValue(
            "manual_dark_artifact_removed_pixels",
            manualDarkArtifactRemovedPixels
        );

        results.addValue(
            "manual_dark_artifact_brush_size_px",
            cleanDarkArtifactsBeforeDetection
                ? artifactEraserBrushSize
                : 0
        );

        results.addValue(
            "manual_dark_artifact_mask_file",
            manualDarkArtifactMaskFile
        );

        results.addValue(
            "border_artifact_filter",
            FGJ_BORDER_FILTER_VERSION
        );

        results.addValue(
            "border_artifact_count",
            borderArtifactCount
        );

        results.addValue(
            "border_artifact_small_pass_count",
            borderArtifactSmallPassCount
        );

        results.addValue(
            "manual_exclusion_mask",
            manualExclusionRois.length > 0 ? "Y" : "N"
        );

        results.addValue(
            "manual_exclusion_zone_count",
            manualExclusionRois.length
        );

        results.addValue(
            "manual_exclusion_area_px2",
            manualExclusionMask != null
                ? manualExclusionMask.getStatistics().area
                : 0
        );

        results.addValue(
            "touching_separation_method",
            seededPartitionApplied
                ? "INNER_SEED_CONSTRAINED_REGION_GROWING_EXPERIMENTAL"
                : "NONE"
        );

        results.addValue(
            "enclosed_interior_count",
            useSeededPartition
                ? enclosedInteriorCount
                : 0
        );

        results.addValue(
            "enclosed_interior_min_area_px2",
            useSeededPartition
                ? minimumInteriorArea
                : 0
        );

        results.addValue(
            "manual_partition_seed_count",
            manualPartitionSeedCount
        );

        results.addValue(
            "seeded_partition_candidates_before",
            seededPartitionCandidateCountBefore
        );

        results.addValue(
            "seeded_partition_candidates_after",
            seededPartitionCandidateCountAfter
        );

        results.addValue(
            "software_version",
            FGJ_SingleImage.VERSION
        );
    }
    results.show("FungiGrowthJ Results");

    var overlay = new Overlay();
    for (var q = 0; q < candidates.length; q++) {
        var reviewed = candidates[q];
        if (reviewed.final_type == "ignore") continue;

        reviewed.roi.setStrokeWidth(3.0);
        overlay.add(reviewed.roi);

        overlay.add(new TextRoi(
            Math.round(reviewed.centroid_x_px),
            Math.round(reviewed.centroid_y_px),
            reviewed.object_id + " " + reviewed.final_type,
            new Font("SansSerif", Font.BOLD, 14)
        ));
    }
    reviewImage.setOverlay(overlay);

    var centralMessage = centralCount == 1
        ? "Central-colony assignment is valid."
        : centralCount == 0
            ? "WARNING: no object was confirmed as central."
            : "WARNING: more than one object was confirmed as central.";

    // ------------------------------------------------------------
    // Persist final biological ROIs after review.
    // All final reviewed ROIs are written, including ignored fragments,
    // so the complete review state remains auditable.
    // ------------------------------------------------------------

    var finalRoisSavedPath = "";

    if (fgFinalRoisPath != "") {
        var finalRoisForSave = [];
        var finalNamesForSave = [];

        for (var fr = 0; fr < candidates.length; fr++) {
            if (candidates[fr].roi == null) continue;

            finalRoisForSave.push(candidates[fr].roi);
            finalNamesForSave.push(
                candidates[fr].object_id + "_" +
                candidates[fr].final_type
            );
        }

        finalRoisSavedPath = saveRoiZip(
            fgFinalRoisPath,
            finalRoisForSave,
            finalNamesForSave
        );

        // saveRoiZip uses a dedicated hidden manager, so persistence does not
        // alter the interactive review manager and no restore/reset is needed.
    }

    // ------------------------------------------------------------
    // MANUAL COLONY ADDITION BEFORE EXPORT
    // ------------------------------------------------------------
    function addManualColony() {
        reviewImage.setOverlay(null);
        reviewImage.deleteRoi();
        if (reviewImage.getWindow() != null) reviewImage.getWindow().toFront();

        var addDialog = new NonBlockingGenericDialog(
            "FungiGrowthJ - Add Colony Manually"
        );
        addDialog.addMessage(
            "DRAW A MISSING COLONY MANUALLY\n\n" +
            "1. Draw a closed area ROI around the colony.\n" +
            "2. Press 'Use ROI'.\n" +
            "3. Choose its biological type.\n\n" +
            "The same measurement pipeline used for automatic ROIs will be applied."
        );
        addDialog.setOKLabel("Use ROI");
        addDialog.showDialog();

        if (addDialog.wasCanceled()) return false;

        var manualRoi = reviewImage.getRoi();
        if (manualRoi == null || manualRoi.isLine()) {
            IJ.showMessage(
                "FungiGrowthJ - Add Colony Manually",
                "No valid closed area ROI was detected."
            );
            return false;
        }

        try { manualRoi = manualRoi.clone(); } catch (ignoredAddClone) {}

        var manualMeasurements = measureRoi(
            reviewImage,
            manualRoi,
            centerX,
            centerY
        );

        var typeDialog = new GenericDialog(
            "FungiGrowthJ - Classify Added Colony"
        );
        typeDialog.addChoice(
            "Colony type:",
            ["satellite", "central", "ignore"],
            "satellite"
        );
        typeDialog.setOKLabel("Add colony");
        typeDialog.showDialog();

        if (typeDialog.wasCanceled()) {
            reviewImage.deleteRoi();
            return false;
        }

        var finalType = typeDialog.getNextChoice();
        var addedCandidate = {
            roi_manager_index: -1,
            roi: manualRoi,
            object_id: padColonyId(colonyCounter++),
            proposed_type: finalType == "central" ? "central" : "candidate_satellite",
            final_type: finalType,
            review_status: "manual_added",
            detection_source: "manual_add",
            review_flag: manualMeasurements.circularity < lowCircularityThreshold ? "low_circularity_manual_add" : "",
            edited_manually: true,
            review_note: "Colony manually added by user.",
            parent_object_id: "",
            edit_operation: "ROI_MANUAL_ADD"
        };

        copyMeasurements(addedCandidate, manualMeasurements);
        candidates.push(addedCandidate);

        roiManager.addRoi(manualRoi.clone());
        addedCandidate.roi_manager_index = roiManager.getCount() - 1;
        roiManager.rename(
            addedCandidate.roi_manager_index,
            addedCandidate.object_id + "_manual_add"
        );

        reviewImage.setRoi(manualRoi);
        reviewImage.updateAndDraw();
        return true;
    }

    // ------------------------------------------------------------
    // REVIEW COMPLETED — styled summary
    // ------------------------------------------------------------

    var reviewCompletedDialog =
        new GenericDialog(
            "FungiGrowthJ - Review Completed"
        );

    var reviewCompletedHeader =
        new Panel(
            new FlowLayout(
                FlowLayout.LEFT,
                5,
                0
            )
        );

    var reviewCompletedTitle =
        new Label(
            "REVIEW COMPLETED"
        );

    reviewCompletedTitle.setFont(
        new AwtFont(
            "SansSerif",
            AwtFont.BOLD,
            15
        )
    );

    reviewCompletedTitle.setForeground(
        new AwtColor(
            0,
            120,
            70
        )
    );

    reviewCompletedHeader.add(
        reviewCompletedTitle
    );

    reviewCompletedDialog.addPanel(
        reviewCompletedHeader
    );

    reviewCompletedDialog.addMessage(
        "All detected objects have passed through guided review.\n"
    );


    var reviewSummaryPanel =
        new Panel(
            new FlowLayout(
                FlowLayout.LEFT,
                8,
                0
            )
        );

    var detectedLabel =
        new Label(
            "Detected objects:"
        );

    detectedLabel.setFont(
        new AwtFont(
            "SansSerif",
            AwtFont.BOLD,
            12
        )
    );

    reviewSummaryPanel.add(
        detectedLabel
    );

    var detectedValue =
        new Label(
            String(
                candidates.length
            )
        );

    detectedValue.setFont(
        new AwtFont(
            "SansSerif",
            AwtFont.BOLD,
            14
        )
    );

    reviewSummaryPanel.add(
        detectedValue
    );

    reviewCompletedDialog.addPanel(
        reviewSummaryPanel
    );


    var centralStatusPanel =
        new Panel(
            new FlowLayout(
                FlowLayout.LEFT,
                8,
                0
            )
        );

    var centralStatusLabel =
        new Label(
            "Central colony:"
        );

    centralStatusLabel.setFont(
        new AwtFont(
            "SansSerif",
            AwtFont.BOLD,
            12
        )
    );

    centralStatusPanel.add(
        centralStatusLabel
    );

    var centralStatusText =
        centralCount == 1
        ? "VALID"
        : (
            centralCount == 0
            ? "NOT ASSIGNED"
            : "MULTIPLE ASSIGNMENTS"
        );

    var centralStatusValue =
        new Label(
            centralStatusText
        );

    centralStatusValue.setFont(
        new AwtFont(
            "SansSerif",
            AwtFont.BOLD,
            12
        )
    );

    centralStatusValue.setForeground(
        centralCount == 1
        ? new AwtColor(0, 120, 70)
        : new AwtColor(175, 70, 25)
    );

    centralStatusPanel.add(
        centralStatusValue
    );

    reviewCompletedDialog.addPanel(
        centralStatusPanel
    );


    reviewCompletedDialog.addMessage(
        "\nAUDIT TRAIL\n" +
        "ROI Manager entries were renamed with their final status.\n" +
        (
            removeIgnoredRois
            ? "Ignored ROIs were removed from ROI Manager.\n"
            : "Ignored ROIs were preserved for auditability.\n"
        ) +
        "The reviewed table is sorted by increasing circularity." +
        (
            fgFinalRoisPath != ""
            ? "\nAutomatic and final ROI sets are saved for later review/reanalysis."
            : ""
        )
    );

    reviewCompletedDialog.addChoice(
        "Next action:",
        [
            "Continue to export",
            "Add colonies manually",
            "Return to ROI review",
            "Mark this observation for later review"
        ],
        centralCount == 1
        ? "Continue to export"
        : "Return to ROI review"
    );

    reviewCompletedDialog.setOKLabel(
        "Continue"
    );

    reviewCompletedDialog.showDialog();

    if (reviewCompletedDialog.wasCanceled()) {
        throw "Review completion canceled.";
    }

    var reviewCompletedAction =
        reviewCompletedDialog.getNextChoice();

    if (reviewCompletedAction == "Add colonies manually") {
        var addedCount = 0;
        var keepAdding = true;

        while (keepAdding) {
            if (addManualColony()) addedCount++;

            var nextAddDialog = new GenericDialog(
                "FungiGrowthJ - Manual Colony Addition"
            );
            nextAddDialog.addMessage(
                "Manual colonies added in this pass: " + addedCount + "\n\n" +
                "The new ROIs have been added to the reviewed candidates."
            );
            nextAddDialog.addChoice(
                "Next action:",
                ["Add another colony", "Finish manual addition"],
                addedCount > 0 ? "Add another colony" : "Finish manual addition"
            );
            nextAddDialog.setOKLabel("Continue");
            nextAddDialog.showDialog();

            if (nextAddDialog.wasCanceled()) {
                keepAdding = false;
            } else {
                keepAdding = nextAddDialog.getNextChoice() == "Add another colony";
            }
        }

        updateDecisionPreview();

        centralCount = 0;
        for (var postAddIndex = 0; postAddIndex < candidates.length; postAddIndex++) {
            if (candidates[postAddIndex].final_type == "central") centralCount++;
        }

        if (fgFinalRoisPath != "") {
            var updatedFinalRois = [];
            var updatedFinalNames = [];
            for (var postSaveIndex = 0; postSaveIndex < candidates.length; postSaveIndex++) {
                if (candidates[postSaveIndex].roi == null) continue;
                updatedFinalRois.push(candidates[postSaveIndex].roi);
                updatedFinalNames.push(
                    candidates[postSaveIndex].object_id + "_" + candidates[postSaveIndex].final_type
                );
            }
            finalRoisSavedPath = saveRoiZip(
                fgFinalRoisPath,
                updatedFinalRois,
                updatedFinalNames
            );
        }
    }

    if (
        reviewCompletedAction ==
        "Return to ROI review"
    ) {
        // Restarting the current image is deliberately used instead of trying
        // to mutate the already-completed review loop in place. Batch keeps
        // the same observation active; with reused scale/agar this is fast and
        // avoids carrying an inconsistent partial review state forward.
        return {
            status: "RESTART_REVIEW",
            batch_item_id: fgBatchItemId,
            single_image_version: FGJ_SingleImage.VERSION,
            seeded_partition_default: useSeededPartition,
            message: "User requested another ROI-review pass before export."
        };
    }

    if (
        reviewCompletedAction ==
        "Mark this observation for later review"
    ) {
        return {
            status: "REVIEW_DEFERRED",
            batch_item_id: fgBatchItemId,
            single_image_version: FGJ_SingleImage.VERSION,
            final_rois_file: finalRoisSavedPath,
            message: "User deferred the observation from Review Completed."
        };
    }


    // ============================================================
    // CLOSE DETECTION MASK AFTER ALL DETECTION STEPS
    // ============================================================
    if (
        typeof maskImage !== "undefined" &&
        maskImage != null
    ) {
        try {
            maskImage.changes = false;
            maskImage.close();
        } catch (maskCloseErrorFinal) {}
    }

    // ============================================================
    // FINAL STEP — EXPORT REVIEWED RESULTS
    // ============================================================

    var SaveDialog = Java.type("ij.io.SaveDialog");
    var File = Java.type("java.io.File");
    var FileSaver = Java.type("ij.io.FileSaver");

    var exportedCsvPath = "";

    if (fgBatchMode) {

        if (fgBatchOutputCsv == "") {

            throw new Error(
                "Batch mode requires context.output_csv_path."
            );
        }

        var targetFile =
            new File(
                fgBatchOutputCsv
            );

        var targetParent =
            targetFile.getParentFile();

        if (
            targetParent != null &&
            !targetParent.exists()
        ) {

            if (
                !targetParent.mkdirs() &&
                !targetParent.exists()
            ) {

                throw new Error(
                    "Could not create Batch results folder:\n" +
                    targetParent.getAbsolutePath()
                );
            }
        }

        results.save(
            targetFile.getAbsolutePath()
        );

        if (
            !targetFile.exists() ||
            targetFile.length() <= 0
        ) {

            throw new Error(
                "Result CSV was not created or is empty."
            );
        }

        exportedCsvPath =
            String(
                targetFile.getAbsolutePath()
            );

        var imageCompletedDialog =
            new GenericDialog(
                "FungiGrowthJ - Image Completed"
            );

        var imageCompletedHeader =
            new Panel(new FlowLayout(FlowLayout.LEFT, 5, 0));

        var imageCompletedTitle =
            new Label("IMAGE COMPLETED");

        imageCompletedTitle.setFont(
            new AwtFont("SansSerif", AwtFont.BOLD, 15)
        );

        imageCompletedTitle.setForeground(
            new AwtColor(0, 120, 70)
        );

        imageCompletedHeader.add(imageCompletedTitle);
        imageCompletedDialog.addPanel(imageCompletedHeader);

        imageCompletedDialog.addMessage(
            "Analysis completed and the CSV was saved automatically.\n\n" +
            (
                fgBatchItemId != ""
                ? "Batch item: " + fgBatchItemId + "\n\n"
                : ""
            ) +
            "RESULT FILE\n" +
            exportedCsvPath
        );

        imageCompletedDialog.setOKLabel("Next image");
        imageCompletedDialog.showDialog();

    } else {

        var exportDialog =
            new GenericDialog(
                "FungiGrowthJ - Step 6 of 6: Export Results"
            );

        var exportHeader =
            new Panel(
                new FlowLayout(
                    FlowLayout.LEFT,
                    5,
                    0
                )
            );

        var exportTitle =
            new Label(
                "EXPORT RESULTS"
            );

        exportTitle.setFont(
            new AwtFont(
                "SansSerif",
                AwtFont.BOLD,
                15
            )
        );

        exportTitle.setForeground(
            new AwtColor(
                0,
                105,
                125
            )
        );

        exportHeader.add(
            exportTitle
        );

        exportDialog.addPanel(
            exportHeader
        );

        addStepIndicator(
            exportDialog,
            6,
            6


        );



        exportDialog.addMessage(
            
            "Review is complete. The measurements are ready to export."
        );

        var csvContentsTitle =
            new Panel(
                new FlowLayout(
                    FlowLayout.LEFT,
                    5,
                    0
                )
            );

        var csvContentsLabel =
            new Label(
                "CSV CONTENTS"
            );

        csvContentsLabel.setFont(
            new AwtFont(
                "SansSerif",
                AwtFont.BOLD,
                12
            )
        );

        csvContentsTitle.add(
            csvContentsLabel
        );

        exportDialog.addPanel(
            csvContentsTitle
        );

        exportDialog.addMessage(
            "• Pixel and calibrated measurements\n" +
            "• Colony classification and review decisions\n" +
            "• ROI / QA traceability\n" +
            "• Processing and calibration metadata"
        );

        exportDialog.addCheckbox(
            "Save reviewed results as CSV",
            true
        );

        exportDialog.setOKLabel(
            "Continue"
        );

        exportDialog.showDialog();

        if (!exportDialog.wasCanceled()) {

            var saveCsv =
                exportDialog.getNextBoolean();

            if (saveCsv) {

                var defaultCsvName =
                    sourceImage.getShortTitle() +
                    "_FungiGrowthJ_results";

                var saveDialog =
                    new SaveDialog(
                        "Save FungiGrowthJ Results",
                        defaultCsvName,
                        ".csv"
                    );

                var saveDirectory =
                    saveDialog.getDirectory();

                var saveFileName =
                    saveDialog.getFileName();

                if (
                    saveDirectory != null &&
                    saveFileName != null
                ) {

                    var csvPath =
                        saveDirectory +
                        saveFileName;

                    try {

                        results.save(
                            csvPath
                        );

                        exportedCsvPath =
                            csvPath;

                        IJ.showMessage(
                            "FungiGrowthJ - Export Completed",
                            "Results saved successfully:\n\n" +
                            csvPath
                        );

                    } catch (exportError) {

                        IJ.showMessage(
                            "FungiGrowthJ - Export Error",
                            "The CSV could not be saved.\n\n" +
                            exportError
                        );
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------
    // BATCH WINDOW CLEANUP
    // ------------------------------------------------------------
    //
    // Standalone mode leaves the guided-review image available for
    // inspection. Batch mode closes it after export so it cannot become
    // Fiji's active image during the next observation.
    //
    if (fgBatchMode) {

        try {

            if (
                typeof reviewImage !== "undefined" &&
                reviewImage != null
            ) {

                reviewImage.changes =
                    false;

                reviewImage.close();
            }

        } catch (reviewCloseError) {

            IJ.log(
                "FungiGrowthJ Batch review-window cleanup warning: " +
                reviewCloseError
            );
        }

        // Restore the real source image as current until Batch closes it.
        try {

            if (
                sourceImage != null &&
                sourceImage.getWindow() != null
            ) {

                WindowManager.setCurrentWindow(
                    sourceImage.getWindow()
                );
            }

        } catch (sourceRestoreError) {

            IJ.log(
                "FungiGrowthJ Batch source-window restore warning: " +
                sourceRestoreError
            );
        }
    }


    return {
        status:
            exportedCsvPath != ""
            ? "COMPLETED"
            : "REVIEW",

        result_file:
            exportedCsvPath,

        automatic_rois_file:
            automaticRoisSavedPath,

        final_rois_file:
            finalRoisSavedPath,

        artifact_cleanup_mask_file:
            manualDarkArtifactMaskFile,

        analysis_revision:
            fgAnalysisRevision,

        batch_item_id:
            fgBatchItemId,

        single_image_version:
            FGJ_SingleImage.VERSION,

        detection_settings: {
            binary_closing_iterations:
                closingIterations,
            marker_gap_closure_iterations:
                markerGapClosureIterations,
            manual_dark_artifact_cleanup:
                cleanDarkArtifactsBeforeDetection,
            manual_dark_artifact_removed_pixels:
                manualDarkArtifactRemovedPixels,
            manual_dark_artifact_brush_size_px:
                cleanDarkArtifactsBeforeDetection
                ? artifactEraserBrushSize
                : 0,
            manual_dark_artifact_mask_file:
                manualDarkArtifactMaskFile,
            enhanced_touching_partition:
                useSeededPartition,
            minimum_enclosed_interior_area:
                minimumInteriorArea,
            minimum_candidate_area:
                minimumArea,
            maximum_candidate_area:
                maximumArea,
            detect_very_small_candidates:
                detectVerySmallCandidates,
            minimum_very_small_candidate_area:
                minimumVerySmallArea,
            exclude_edge_objects:
                excludeEdgeObjects,
            mask_agar_zones_manually:
                maskAgarZonesManually
        },

        source_image_filename:
            (
                sourceImage != null &&
                typeof sourceImage.getShortTitle == "function"
            )
            ? String(sourceImage.getShortTitle())
            : safeString(
                fgExplicitSourceImage
            ),

        agar_reference: {
            persist:
                agarReferenceShouldPersist,

            strain:
                fgStrainId,

            replicate:
                fgReplicateId,

            established_date:
                agarReferenceEstablished
                ? fgDateIso
                : agarReferenceSourceDate,

            scale_unit:
                scaleUnit,

            width_physical:
                acceptedBounds.width *
                calibration.pixelWidth,

            height_physical:
                acceptedBounds.height *
                calibration.pixelHeight,

            width_px_source:
                acceptedBounds.width,

            height_px_source:
                acceptedBounds.height,

            center_fraction_x:
                acceptedCenterX /
                sourceImage.getWidth(),

            center_fraction_y:
                acceptedCenterY /
                sourceImage.getHeight(),

            roi_source:
                agarRoiSource
        },

        calibration: {
            unit:
                scaleUnit,

            unit_per_pixel:
                unitPerPixel,

            pixels_per_unit:
                pixelsPerUnit,

            known_distance:
                knownDistance,

            line_length_pixels:
                lineLengthPixels,

            reused:
                reusedCalibration
        }
    };

};

// ------------------------------------------------------------
// DIRECT TEST MODE
// ------------------------------------------------------------
// Keep TRUE while validating this module by itself in Fiji.
// When connected to the launcher, change to FALSE and call:
//   FGJ_SingleImage.run();
// ------------------------------------------------------------

var FGJ_SINGLE_IMAGE_RUN_DIRECTLY =
    !(
        typeof FGJ_SUPPRESS_SINGLE_IMAGE_AUTORUN !== "undefined" &&
        FGJ_SUPPRESS_SINGLE_IMAGE_AUTORUN === true
    );

if (FGJ_SINGLE_IMAGE_RUN_DIRECTLY) {
    FGJ_SingleImage.run();
}
