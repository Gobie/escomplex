/*globals exports, require */

'use strict';

exports.analyse = analyse;

var check = require('check-types');

function analyse (ast, walker, options, next) {
    var settings, currentReport, clearDependencies = true, scopeStack = [], report;

    try {
        check.assert.object(ast, 'Invalid syntax tree');
        check.assert.object(walker, 'Invalid walker');
        check.assert.function(walker.walk, 'Invalid walker.walk method');

        if (check.object(options)) {
            settings = options;
        } else {
            settings = getDefaultSettings();
        }

        // TODO: loc is moz-specific, move to walker?
        report = createReport(ast.loc);

        walker.walk(ast, settings, {
            processNode: processNode,
            createScope: createScope,
            popScope: popScope
        });

        calculateMetrics(report, settings);

        return next(null, report);
    } catch (e) {
        return next(e);
    }

    function processNode (node, syntax) {
        processLloc(report, node, syntax, currentReport);
        processCyclomatic(report, node, syntax, currentReport);
        processOperators(report, node, syntax, currentReport);
        processOperands(report, node, syntax, currentReport);

        if (processDependencies(report, node, syntax, clearDependencies)) {
            // HACK: This will fail with async or if other syntax than CallExpression introduces dependencies.
            // TODO: Come up with a less crude approach.
            clearDependencies = false;
        }
    }

    function createScope (name, loc, parameterCount) {
        currentReport = createFunctionReport(name, loc, parameterCount);

        report.functions.push(currentReport);
        report.aggregate.params += parameterCount;

        scopeStack.push(currentReport);
    }

    function popScope () {
        scopeStack.pop();

        if (scopeStack.length > 0) {
            currentReport = scopeStack[scopeStack.length - 1];
        } else {
            currentReport = undefined;
        }
    }
}

function getDefaultSettings () {
    return {
        logicalor: true,
        switchcase: true,
        forin: false,
        trycatch: false,
        newmi: false
    };
}

function createReport (lines) {
    return {
        aggregate: createFunctionReport(undefined, lines, 0),
        functions: [],
        dependencies: []
    };
}

function createFunctionReport (name, lines, params) {
    var result = {
        name: name,
        sloc: {
            logical: 0
        },
        cyclomatic: 1,
        halstead: createInitialHalsteadState(),
        params: params
    };

    if (check.object(lines)) {
        result.line = lines.start.line;
        result.sloc.physical = lines.end.line - lines.start.line + 1;
    }

    return result;
}

function createInitialHalsteadState () {
    return {
        operators: createInitialHalsteadItemState(),
        operands: createInitialHalsteadItemState()
    };
}

function createInitialHalsteadItemState () {
    return {
        distinct: 0,
        total: 0,
        identifiers: []
    };
}

function processLloc (report, node, syntax, currentReport) {
    incrementCounter(node, syntax, 'lloc', incrementLogicalSloc.bind(null, report), currentReport);
}

function incrementCounter (node, syntax, name, incrementFn, currentReport) {
    var amount = syntax[name];

    if (check.number(amount)) {
        incrementFn(currentReport, amount);
    } else if (check.function(amount)) {
        incrementFn(currentReport, amount(node));
    }
}

function incrementLogicalSloc (report, currentReport, amount) {
    report.aggregate.sloc.logical += amount;

    if (currentReport) {
        currentReport.sloc.logical += amount;
    }
}

function processCyclomatic (report, node, syntax, currentReport) {
    incrementCounter(node, syntax, 'cyclomatic', incrementCyclomatic.bind(null, report), currentReport);
}

function incrementCyclomatic (report, currentReport, amount) {
    report.aggregate.cyclomatic += amount;

    if (currentReport) {
        currentReport.cyclomatic += amount;
    }
}

function processOperators (report, node, syntax, currentReport) {
    processHalsteadMetric(report, node, syntax, 'operators', currentReport);
}

function processOperands (report, node, syntax, currentReport) {
    processHalsteadMetric(report, node, syntax, 'operands', currentReport);
}

function processHalsteadMetric (report, node, syntax, metric, currentReport) {
    if (check.array(syntax[metric])) {
        syntax[metric].forEach(function (s) {
            var identifier;

            if (check.function(s.identifier)) {
                identifier = s.identifier(node);
            } else {
                identifier = s.identifier;
            }

            if (check.function(s.filter) === false || s.filter(node) === true) {
                halsteadItemEncountered(report, currentReport, metric, identifier);
            }
        });
    }
}

function halsteadItemEncountered (report, currentReport, metric, identifier) {
    if (currentReport) {
        incrementHalsteadItems(currentReport, metric, identifier);
    }

    incrementHalsteadItems(report.aggregate, metric, identifier);
}

function incrementHalsteadItems (baseReport, metric, identifier) {
    incrementDistinctHalsteadItems(baseReport, metric, identifier);
    incrementTotalHalsteadItems(baseReport, metric);
}

function incrementDistinctHalsteadItems (baseReport, metric, identifier) {
    if (Object.prototype.hasOwnProperty(identifier)) {
        // Avoid clashes with built-in property names.
        incrementDistinctHalsteadItems(baseReport, metric, '_' + identifier);
    } else if (isHalsteadMetricDistinct(baseReport, metric, identifier)) {
        recordDistinctHalsteadMetric(baseReport, metric, identifier);
        incrementHalsteadMetric(baseReport, metric, 'distinct');
    }
}

function isHalsteadMetricDistinct (baseReport, metric, identifier) {
    return baseReport.halstead[metric].identifiers.indexOf(identifier) === -1;
}

function recordDistinctHalsteadMetric (baseReport, metric, identifier) {
    baseReport.halstead[metric].identifiers.push(identifier);
}

function incrementHalsteadMetric (baseReport, metric, type) {
    if (baseReport) {
        baseReport.halstead[metric][type] += 1;
    }
}

function incrementTotalHalsteadItems (baseReport, metric) {
    incrementHalsteadMetric(baseReport, metric, 'total');
}

function processDependencies (report, node, syntax, clearDependencies) {
    var dependencies;

    if (check.function(syntax.dependencies)) {
        dependencies = syntax.dependencies(node, clearDependencies);
        if (check.object(dependencies) || check.array(dependencies)) {
            report.dependencies = report.dependencies.concat(dependencies);
        }

        return true;
    }

    return false;
}

function calculateMetrics (report, settings) {
    var count, indices, sums, averages;

    count = report.functions.length;
    indices = {
        loc: 0,
        cyclomatic: 1,
        effort: 2,
        params: 3
    };
    sums = [ 0, 0, 0, 0 ];

    report.functions.forEach(function (functionReport) {
        calculateCyclomaticDensity(functionReport);
        calculateHalsteadMetrics(functionReport.halstead);
        sumMaintainabilityMetrics(sums, indices, functionReport);
    });

    calculateCyclomaticDensity(report.aggregate);
    calculateHalsteadMetrics(report.aggregate.halstead);
    if (count === 0) {
        // Sane handling of modules that contain no functions.
        sumMaintainabilityMetrics(sums, indices, report.aggregate);
        count = 1;
    }

    averages = sums.map(function (sum) { return sum / count; });

    calculateMaintainabilityIndex(
        report,
        averages[indices.effort],
        averages[indices.cyclomatic],
        averages[indices.loc],
        settings
    );

    Object.keys(indices).forEach(function (index) {
        report[index] = averages[indices[index]];
    });
}

function calculateCyclomaticDensity (data) {
    data.cyclomaticDensity = (data.cyclomatic / data.sloc.logical) * 100;
}

function calculateHalsteadMetrics (data) {
    data.length = data.operators.total + data.operands.total;
    if (data.length === 0) {
        nilHalsteadMetrics(data);
    } else {
        data.vocabulary = data.operators.distinct + data.operands.distinct;
        data.difficulty =
            (data.operators.distinct / 2) *
            (data.operands.distinct === 0 ? 1 : data.operands.total / data.operands.distinct);
        data.volume = data.length * (Math.log(data.vocabulary) / Math.log(2));
        data.effort = data.difficulty * data.volume;
        data.bugs = data.volume / 3000;
        data.time = data.effort / 18;
    }
}

function nilHalsteadMetrics (data) {
    data.vocabulary =
        data.difficulty =
        data.volume =
        data.effort =
        data.bugs =
        data.time =
            0;
}

function sumMaintainabilityMetrics (sums, indices, data) {
    sums[indices.loc] += data.sloc.logical;
    sums[indices.cyclomatic] += data.cyclomatic;
    sums[indices.effort] += data.halstead.effort;
    sums[indices.params] += data.params;
}

function calculateMaintainabilityIndex (report, averageEffort, averageCyclomatic, averageLoc, settings) {
    if (averageCyclomatic === 0) {
        throw new Error('Encountered function with cyclomatic complexity zero!');
    }

    report.maintainability =
        171 -
        (3.42 * Math.log(averageEffort)) -
        (0.23 * Math.log(averageCyclomatic)) -
        (16.2 * Math.log(averageLoc));

    if (report.maintainability > 171) {
        report.maintainability = 171;
    }

    if (settings.newmi) {
        report.maintainability = Math.max(0, (report.maintainability * 100) / 171);
    }
}

