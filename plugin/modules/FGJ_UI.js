// ============================================================
// FungiGrowthJ
//
// Module  : FGJ_UI
// Version : 0.1.0
// File    : FGJ_UI.js
//
// Public API:
//   FGJ_UI.progressBar(step, total)
//   FGJ_UI.showMessage(title, message)
//   FGJ_UI.showWarning(title, message)
//   FGJ_UI.showError(title, message)
//   FGJ_UI.showStepInstructions(...)
//   FGJ_UI.retryDialog(...)
//   FGJ_UI.confirmCheckbox(...)
//   FGJ_UI.qaCheckpoint(...)
//   FGJ_UI.showCompletion(...)
//
// Purpose:
// Shared user-interface helpers for FungiGrowthJ.
//
// IMPORTANT:
// This module contains interface behavior only.
// It must not perform scientific calculations.
// ============================================================

var FGJ_UI =
    typeof FGJ_UI !== "undefined"
    ? FGJ_UI
    : {};

FGJ_UI.VERSION = "0.1.0";
FGJ_UI.MODULE_NAME = "FGJ_UI";

FGJ_UI._IJ =
    Java.type("ij.IJ");

FGJ_UI._GenericDialog =
    Java.type("ij.gui.GenericDialog");

FGJ_UI._NonBlockingGenericDialog =
    Java.type("ij.gui.NonBlockingGenericDialog");


// ------------------------------------------------------------
// ASCII progress bar
// ------------------------------------------------------------

FGJ_UI.progressBar = function(step, total) {

    step = Math.max(
        0,
        Math.min(step, total)
    );

    var completed = "";
    var remaining = "";

    for (var i = 0; i < step; i++) {
        completed += "#";
    }

    for (var j = step; j < total; j++) {
        remaining += "-";
    }

    return "[" +
        completed +
        remaining +
        "] Step " +
        step +
        " of " +
        total;
};


// ------------------------------------------------------------
// Basic messages
// ------------------------------------------------------------

FGJ_UI.showMessage =
    function(title, message) {

        FGJ_UI._IJ.showMessage(
            title,
            message
        );
    };


FGJ_UI.showWarning =
    function(title, message) {

        FGJ_UI._IJ.showMessage(
            title,
            "WARNING\n\n" +
            message
        );
    };


FGJ_UI.showError =
    function(title, message) {

        FGJ_UI._IJ.showMessage(
            title,
            "ERROR\n\n" +
            message
        );
    };


// ------------------------------------------------------------
// Non-blocking wizard instruction
// ------------------------------------------------------------
//
// Use this when the user must interact with the image while
// the instruction window remains open, e.g. drawing a line or
// an agar sample ROI.
//
// Returns:
//   true  -> Next/OK
//   false -> Cancel
//

FGJ_UI.showStepInstructions =
    function(
        title,
        step,
        total,
        message,
        okLabel
    ) {

        var dialog =
            new FGJ_UI._NonBlockingGenericDialog(
                title
            );

        dialog.addMessage(
            FGJ_UI.progressBar(
                step,
                total
            ) +
            "\n\n" +
            message
        );

        if (okLabel != null &&
            String(okLabel) != "") {

            dialog.setOKLabel(
                String(okLabel)
            );
        }

        dialog.showDialog();

        return !dialog.wasCanceled();
    };


// ------------------------------------------------------------
// Retry dialog
// ------------------------------------------------------------
//
// Returns:
//   true  -> try again
//   false -> cancel
//

FGJ_UI.retryDialog =
    function(
        title,
        message,
        step,
        total,
        buttonLabel
    ) {

        var dialog =
            new FGJ_UI._GenericDialog(
                title
            );

        var prefix = "";

        if (step != null &&
            total != null) {

            prefix =
                FGJ_UI.progressBar(
                    step,
                    total
                ) +
                "\n\n";
        }

        dialog.addMessage(
            prefix +
            message
        );

        dialog.setOKLabel(
            buttonLabel != null
                ? String(buttonLabel)
                : "Try again"
        );

        dialog.showDialog();

        return !dialog.wasCanceled();
    };


// ------------------------------------------------------------
// Confirmation with explicit checkbox
// ------------------------------------------------------------
//
// Scientific checkpoints should normally require an explicit
// confirmation instead of treating OK as implicit approval.
//
// Returns:
//   true  -> confirmed
//   false -> canceled or checkbox not selected
//

FGJ_UI.confirmCheckbox =
    function(
        title,
        message,
        checkboxLabel,
        step,
        total,
        okLabel
    ) {

        var dialog =
            new FGJ_UI._GenericDialog(
                title
            );

        var prefix = "";

        if (step != null &&
            total != null) {

            prefix =
                FGJ_UI.progressBar(
                    step,
                    total
                ) +
                "\n\n";
        }

        dialog.addMessage(
            prefix +
            message
        );

        dialog.addCheckbox(
            checkboxLabel,
            false
        );

        if (okLabel != null &&
            String(okLabel) != "") {

            dialog.setOKLabel(
                String(okLabel)
            );
        }

        dialog.showDialog();

        if (dialog.wasCanceled()) {
            return false;
        }

        return dialog.getNextBoolean();
    };


// ------------------------------------------------------------
// QA checkpoint
// ------------------------------------------------------------
//
// status:
//   PASS
//   REVIEW
//   ERROR
//   NA
//
// ERROR checkpoints cannot be confirmed.
// REVIEW and PASS require explicit user confirmation.
//
// Returns object:
// {
//   accepted: boolean,
//   status: string,
//   code: string
// }
//

FGJ_UI.qaCheckpoint =
    function(
        title,
        status,
        code,
        message,
        step,
        total
    ) {

        status =
            String(status)
            .toUpperCase();

        code =
            code == null
            ? ""
            : String(code);

        var dialog =
            new FGJ_UI._GenericDialog(
                title
            );

        var prefix = "";

        if (step != null &&
            total != null) {

            prefix =
                FGJ_UI.progressBar(
                    step,
                    total
                ) +
                "\n\n";
        }

        dialog.addMessage(
            prefix +
            "QA STATUS: " +
            status +
            (
                code != ""
                ? "\nQA CODE: " +
                  code
                : ""
            ) +
            "\n\n" +
            message
        );

        if (status == "ERROR") {

            dialog.setOKLabel(
                "Return"
            );

            dialog.showDialog();

            return {
                accepted: false,
                status: status,
                code: code
            };
        }

        dialog.addCheckbox(
            "I reviewed this checkpoint",
            false
        );

        dialog.setOKLabel(
            "Continue"
        );

        dialog.showDialog();

        if (dialog.wasCanceled()) {

            return {
                accepted: false,
                status: status,
                code: code
            };
        }

        return {
            accepted:
                dialog.getNextBoolean(),
            status: status,
            code: code
        };
    };


// ------------------------------------------------------------
// Workflow completion message
// ------------------------------------------------------------

FGJ_UI.showCompletion =
    function(
        title,
        message,
        step,
        total
    ) {

        var dialog =
            new FGJ_UI._GenericDialog(
                title
            );

        var prefix = "";

        if (step != null &&
            total != null) {

            prefix =
                FGJ_UI.progressBar(
                    step,
                    total
                ) +
                "\n\n";
        }

        dialog.addMessage(
            prefix +
            message
        );

        dialog.setOKLabel(
            "Finish"
        );

        dialog.showDialog();

        return !dialog.wasCanceled();
    };


// ------------------------------------------------------------
// MODULE SELF-CHECK
// ------------------------------------------------------------
//
// Set TRUE only if you want to run FGJ_UI.js by itself.
//

var FGJ_UI_RUN_SELF_TEST = false;

if (FGJ_UI_RUN_SELF_TEST) {

    FGJ_UI.showMessage(
        "FungiGrowthJ - FGJ_UI",
        "FGJ_UI " +
        FGJ_UI.VERSION +
        " loaded successfully.\n\n" +
        FGJ_UI.progressBar(
            3,
            6
        )
    );
}
