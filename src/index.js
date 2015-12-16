/**
 * Code complexity reporting for Mozilla-format abstract syntax trees.
 */

/*globals exports, require */

'use strict';

var check = require('check-types'),
    projectHandler = require('./project'),
    moduleHandler = require('./module');


exports.analyse = analyse;
exports.processResults = processResults;

/**
 * Public function `analyse`.
 *
 * Returns an object detailing the complexity of abstract syntax tree(s).
 *
 * @param ast {object|array}  The abstract syntax tree(s) to analyse for
 *                            code complexity.
 * @param walker {object}     The AST walker to use against `ast`.
 * @param [options] {object}  Options to modify the complexity calculation.
 * @param next {function}     Callback to call with error or report.
 *
 */
function analyse (ast, walker, options, next) {
    if (check.array(ast)) {
        return projectHandler.analyse(ast, walker, options, next);
    }

    return moduleHandler.analyse(ast, walker, options, next);
}

/**
 * Public function `processResults`.
 *
 * Given an object with an array of results, it returns results with calculated aggregate values.
 *
 * @param report {object}      The report object with an array of results for calculating aggregates.
 * @param noCoreSize {boolean} Don't compute coresize or the visibility matrix.
 * @param next {function}      Callback to call with error or results.
 *
 */
function processResults(report, noCoreSize, next) {
    return projectHandler.processResults(report, noCoreSize, next);
}
