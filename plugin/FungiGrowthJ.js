// ============================================================
// FungiGrowthJ
//
// File    : FungiGrowthJ.js
// Role    : Main launcher / user entry point
// Version : 0.1.2-portable-self-locating
//
// EXPECTED STRUCTURE
// ------------------
//
// FungiGrowthJ/
// ├── FungiGrowthJ.js
// └── modules/
//     ├── FGJ_SingleImage.js
//     ├── FGJ_Batch.js
//     └── ...
//
// The launcher first tries to determine ITS OWN file location and then
// resolves modules/ relative to that folder.
// ============================================================


// ------------------------------------------------------------
// JAVA / IMAGEJ CLASSES
// ------------------------------------------------------------

var IJ =
    Java.type("ij.IJ");

var GenericDialog =
    Java.type("ij.gui.GenericDialog");

var DirectoryChooser =
    Java.type("ij.io.DirectoryChooser");

var File =
    Java.type("java.io.File");

var System =
    Java.type("java.lang.System");


// ============================================================
// CONSTANTS
// ============================================================

var FGJ_LAUNCHER_VERSION =
    "0.1.2-portable-self-locating";

var FGJ_MODULES_FOLDER =
    "modules";


// ============================================================
// PATH HELPERS
// ============================================================

function normalizePath(path) {

    if (path == null) {
        return "";
    }

    return String(path)
        .replace(/\\/g, "/")
        .replace(/\/+$/, "");
}


function directoryExists(path) {

    var file =
        new File(
            String(path)
        );

    return (
        file.exists() &&
        file.isDirectory()
    );
}


function validInstallationRoot(path) {

    if (
        path == null ||
        String(path).trim() == ""
    ) {
        return false;
    }

    var root =
        normalizePath(
            path
        );

    return directoryExists(
        root +
        "/" +
        FGJ_MODULES_FOLDER
    );
}


// ============================================================
// FIND THIS SCRIPT'S OWN DIRECTORY
// ============================================================
//
// Fiji scripting engines can expose the current script path in slightly
// different ways. Try several safe possibilities.
//
// If none is available, we fall back to asking for the FungiGrowthJ folder.
// This fallback happens only because some Fiji/Nashorn configurations do
// not expose the running script filename.
// ============================================================

function currentScriptFilePath() {

    var candidates = [];

    // ImageJ 1.x keeps the path of the most recently loaded macro/script.
    // This is particularly useful when the JavaScript engine itself does
    // not expose __FILE__ or javax.script.filename.
    try {

        var macroFilePath =
            IJ.runMacro(
                'return getInfo("macro.filepath");'
            );

        if (
            macroFilePath != null &&
            String(macroFilePath).trim() != ""
        ) {

            candidates.push(
                String(macroFilePath)
            );
        }

    } catch (ignoredMacroFilePath) {}

    // Common scripting globals.
    try {

        if (
            typeof __FILE__ !==
            "undefined" &&
            __FILE__ != null
        ) {

            candidates.push(
                String(
                    __FILE__
                )
            );
        }

    } catch (ignoredFileGlobal) {}


    try {

        if (
            typeof SCRIPT_FILE !==
            "undefined" &&
            SCRIPT_FILE != null
        ) {

            candidates.push(
                String(
                    SCRIPT_FILE
                )
            );
        }

    } catch (ignoredScriptFileGlobal) {}


    // javax.script.ScriptEngine.FILENAME binding, used by many JSR-223
    // environments including Nashorn-based hosts.
    try {

        var globalObject =
            this;

        if (
            globalObject != null &&
            globalObject[
                "javax.script.filename"
            ] != null
        ) {

            candidates.push(
                String(
                    globalObject[
                        "javax.script.filename"
                    ]
                )
            );
        }

    } catch (ignoredFilenameBinding) {}


    // Keep only candidates that point to an existing file.
    for (var i = 0;
         i < candidates.length;
         i++) {

        try {

            var candidateFile =
                new File(
                    candidates[i]
                );

            if (
                candidateFile.exists() &&
                candidateFile.isFile()
            ) {

                return String(
                    candidateFile
                        .getAbsolutePath()
                );
            }

        } catch (ignoredCandidate) {}
    }

    return null;
}


function findInstallationRoot() {

    // --------------------------------------------------------
    // 1. BEST CASE — relative to this launcher itself
    // --------------------------------------------------------

    var scriptPath =
        currentScriptFilePath();

    if (
        scriptPath != null
    ) {

        var scriptFile =
            new File(
                scriptPath
            );

        var scriptParent =
            scriptFile
                .getParentFile();

        if (
            scriptParent != null
        ) {

            var ownFolder =
                String(
                    scriptParent
                        .getAbsolutePath()
                );

            if (
                validInstallationRoot(
                    ownFolder
                )
            ) {

                return ownFolder;
            }
        }
    }


    // --------------------------------------------------------
    // 2. IMAGEJ CURRENT DIRECTORY FALLBACK
    // --------------------------------------------------------

    try {

        var imagejCurrentDirectory =
            IJ.getDirectory(
                "current"
            );

        if (
            validInstallationRoot(
                imagejCurrentDirectory
            )
        ) {

            return String(
                new File(
                    imagejCurrentDirectory
                ).getAbsolutePath()
            );
        }

    } catch (ignoredImageJCurrentDirectory) {}


    // --------------------------------------------------------
    // 3. DEVELOPMENT FALLBACK — process working directory
    // --------------------------------------------------------

    try {

        var currentDirectory =
            System.getProperty(
                "user.dir"
            );

        if (
            validInstallationRoot(
                currentDirectory
            )
        ) {

            return String(
                new File(
                    currentDirectory
                ).getAbsolutePath()
            );
        }

    } catch (ignoredCurrentDirectory) {}


    // --------------------------------------------------------
    // 4. STANDARD FIJI PLUGINS FALLBACK
    // --------------------------------------------------------

    try {

        var pluginsDirectory =
            IJ.getDirectory(
                "plugins"
            );

        if (
            pluginsDirectory != null
        ) {

            var pluginsRoot =
                normalizePath(
                    pluginsDirectory
                );

            var standardCandidate =
                pluginsRoot +
                "/FungiGrowthJ";

            if (
                validInstallationRoot(
                    standardCandidate
                )
            ) {

                return standardCandidate;
            }
        }

    } catch (ignoredPluginsDirectory) {}


    // --------------------------------------------------------
    // 5. LAST RESORT — ask for the FungiGrowthJ folder
    // --------------------------------------------------------

    var chooser =
        new DirectoryChooser(
            "Select the FungiGrowthJ folder"
        );

    var selected =
        chooser.getDirectory();

    if (
        selected != null &&
        validInstallationRoot(
            selected
        )
    ) {

        return String(
            new File(
                selected
            ).getAbsolutePath()
        );
    }

    return null;
}


// ============================================================
// MODULE LOADER
// ============================================================

function modulePath(
    installationRoot,
    filename
) {

    return (
        normalizePath(
            installationRoot
        ) +
        "/" +
        FGJ_MODULES_FOLDER +
        "/" +
        filename
    );
}


function loadModule(
    installationRoot,
    filename
) {

    var path =
        modulePath(
            installationRoot,
            filename
        );

    var file =
        new File(
            path
        );

    if (
        !file.exists()
    ) {

        throw new Error(
            "Required FungiGrowthJ module was not found:\n\n" +
            path
        );
    }

    load(
        String(
            file.toURI()
                .toString()
        )
    );
}


// ============================================================
// PORTABLE MODULE CONTEXT
// ============================================================

function exposePortablePaths(
    installationRoot
) {

    // These globals are intentionally exposed to modules loaded by the
    // launcher. They allow Batch and other modules to find sibling files
    // without opening file choosers.
    FGJ_INSTALL_ROOT =
        normalizePath(
            installationRoot
        );

    FGJ_MODULES_ROOT =
        FGJ_INSTALL_ROOT +
        "/" +
        FGJ_MODULES_FOLDER;
}


function ensureUILoaded(
    installationRoot
) {

    if (
        typeof FGJ_UI !== "undefined" &&
        FGJ_UI != null
    ) {
        return;
    }

    loadModule(
        installationRoot,
        "FGJ_UI.js"
    );
}


function ensureExperimentManagerLoaded(
    installationRoot
) {

    if (
        typeof FGJ_ExperimentManager !== "undefined" &&
        FGJ_ExperimentManager != null &&
        typeof FGJ_ExperimentManager.run == "function"
    ) {
        return;
    }

    ensureUILoaded(
        installationRoot
    );

    loadModule(
        installationRoot,
        "FGJ_ExperimentManager.js"
    );

    if (
        typeof FGJ_ExperimentManager === "undefined" ||
        FGJ_ExperimentManager == null ||
        typeof FGJ_ExperimentManager.run != "function"
    ) {

        throw new Error(
            "FGJ_ExperimentManager.js was loaded, but " +
            "FGJ_ExperimentManager.run() is not available."
        );
    }
}


// ============================================================
// SINGLE IMAGE MODULE
// ============================================================

function ensureSingleImageLoaded(
    installationRoot
) {

    if (
        typeof FGJ_SingleImage !==
        "undefined" &&
        FGJ_SingleImage != null &&
        typeof FGJ_SingleImage.run ==
        "function"
    ) {

        return;
    }

    FGJ_SUPPRESS_SINGLE_IMAGE_AUTORUN =
        true;

    try {

        loadModule(
            installationRoot,
            "FGJ_SingleImage.js"
        );

    } finally {

        FGJ_SUPPRESS_SINGLE_IMAGE_AUTORUN =
            false;
    }


    if (
        typeof FGJ_SingleImage ===
        "undefined" ||
        FGJ_SingleImage == null ||
        typeof FGJ_SingleImage.run !=
        "function"
    ) {

        throw new Error(
            "FGJ_SingleImage.js was loaded, but FGJ_SingleImage.run() " +
            "is not available."
        );
    }
}


// ============================================================
// SINGLE IMAGE SETUP
// ============================================================

function runSingleImage(
    installationRoot
) {

    ensureSingleImageLoaded(
        installationRoot
    );

    var setup =
        new GenericDialog(
            "FungiGrowthJ - Single Image"
        );

    setup.addMessage(
        "Single Image Analysis\n\n" +
        "Analyze the currently open RGB image using the complete\n" +
        "FungiGrowthJ workflow."
    );

    setup.addChoice(
        "Inoculation origin:",
        [
            "Do not record inoculation origin",
            "Record inoculation origin in this image"
        ],
        "Do not record inoculation origin"
    );

    setup.setOKLabel(
        "Start analysis"
    );

    setup.showDialog();

    if (
        setup.wasCanceled()
    ) {

        return;
    }

    var inoculationChoice =
        setup.getNextChoice();

    FGJ_SingleImage.run({
        mode:
            "single",

        record_inoculation_origin:
            inoculationChoice ==
            "Record inoculation origin in this image"
    });
}


// ============================================================
// BATCH
// ============================================================

function runBatch(
    installationRoot
) {

    // Batch depends on the same scientific engine and may need the
    // Experiment Manager automatically when a new experiment has no
    // manifest yet.
    ensureSingleImageLoaded(
        installationRoot
    );

    ensureExperimentManagerLoaded(
        installationRoot
    );

    loadModule(
        installationRoot,
        "FGJ_Batch.js"
    );
}


// ============================================================
// MAIN
// ============================================================

function runFungiGrowthJ() {

    var installationRoot =
        findInstallationRoot();

    if (
        installationRoot == null
    ) {

        IJ.showMessage(
            "FungiGrowthJ - Installation Not Found",
            "The FungiGrowthJ installation folder could not be resolved.\n\n" +
            "Expected structure:\n\n" +
            "FungiGrowthJ/\n" +
            "  FungiGrowthJ.js\n" +
            "  modules/\n" +
            "    FGJ_SingleImage.js\n" +
            "    FGJ_Batch.js\n\n" +
            "Make sure 'modules' is directly beside FungiGrowthJ.js."
        );

        return;
    }

    exposePortablePaths(
        installationRoot
    );


    var dialog =
        new GenericDialog(
            "FungiGrowthJ"
        );

    dialog.addMessage(
        "FungiGrowthJ\n\n" +
        "Image analysis for longitudinal fungal colony growth.\n\n" +
        "What would you like to analyze?"
    );

    dialog.addChoice(
        "Analysis mode:",
        [
            "Single image",
            "Experiment / Batch"
        ],
        "Single image"
    );

    dialog.addMessage(
        "Launcher version: " +
        FGJ_LAUNCHER_VERSION +
        "\n\n" +
        "Installation:\n" +
        normalizePath(
            installationRoot
        )
    );

    dialog.setOKLabel(
        "Continue"
    );

    dialog.showDialog();

    if (
        dialog.wasCanceled()
    ) {

        return;
    }

    var mode =
        dialog.getNextChoice();

    try {

        if (
            mode ==
            "Single image"
        ) {

            runSingleImage(
                installationRoot
            );

        } else {

            runBatch(
                installationRoot
            );
        }

    } catch (error) {

        IJ.showMessage(
            "FungiGrowthJ - Error",
            String(
                error
            )
        );

        throw error;
    }
}


runFungiGrowthJ();
