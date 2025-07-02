import chalk from 'chalk';
import { EventEmitter } from 'events';
import { words } from 'popular-english-words';
import readline from 'readline';

/**
 * Represents a node in the BK-Tree, storing a word and its frequency.
 */
class BKNode {
    constructor(word, frequency = 1) {
        this.word = word;
        this.frequency = frequency;
        this.children = new Map();
    }
}

/**
 * The core autocorrect engine. Handles dictionary loading, BK-Tree construction,
 * and finding/ranking correction suggestions.
 */
class AutoCorrectEngine extends EventEmitter {
    constructor(options = {}) {
        super();
        this.config = {
            dictionarySize: 10000,
            maxEditDistance: 2,
            cacheSize: 1000,
            ...options,
        };
        this.dictionary = new Map(); // word -> frequency score
        this.maxFrequency = 0;
        this.bkTree = null;
        this.cache = new Map();

        this._initialize();
    }

    _initialize() {
        this.loadDictionary();
        this.buildBKTree();
    }

    loadDictionary() {
        try {
            const popularWords = words.getMostPopular(this.config.dictionarySize);
            this.maxFrequency = popularWords.length;

            popularWords.forEach((word, index) => {
                if (word.length > 1 && /^[a-z]+$/.test(word)) {
                    this.dictionary.set(word, this.maxFrequency - index);
                }
            });

            const technicalTerms = [
                'javascript', 'algorithm', 'function', 'variable', 'console', 'terminal',
                'autocorrect', 'suggestion', 'correction', 'dictionary', 'search', 'fuzzy',
                'distance', 'cache', 'performance', 'optimization', 'implementation',
                'architecture', 'efficient', 'structure', 'application', 'system',
                'interface', 'experience', 'machine', 'learning', 'programming',
                'development', 'software', 'computer', 'debugging', 'testing', 'hello'
            ];
            technicalTerms.forEach(term => {
                this.dictionary.set(term, this.maxFrequency * 1.2);
            });

            this.emit('dictionary-loaded', { wordCount: this.dictionary.size });
        } catch (error) {
            console.error(chalk.red('Error loading dictionary:'), error.message);
        }
    }

    buildBKTree() {
        if (this.dictionary.size === 0) return;
        const it = this.dictionary.entries();
        const [firstWord, firstFreq] = it.next().value;

        this.bkTree = new BKNode(firstWord, firstFreq);

        for (const [word, frequency] of it) {
            this._insertIntoBKTree(this.bkTree, new BKNode(word, frequency));
        }
        this.emit('bk-tree-built', { nodeCount: this.dictionary.size });
    }

    _insertIntoBKTree(node, newNode) {
        const distance = this._sift3Distance(node.word, newNode.word);
        if (distance === 0) return;

        const childNode = node.children.get(distance);
        if (childNode) {
            this._insertIntoBKTree(childNode, newNode);
        } else {
            node.children.set(distance, newNode);
        }
    }

    _sift3Distance(s1, s2, maxOffset = 5) {
        if (!s1 || !s1.length) return s2 ? s2.length : 0;
        if (!s2 || !s2.length) return s1.length;

        let c = 0, offset1 = 0, offset2 = 0, lcs = 0;
        while ((c + offset1 < s1.length) && (c + offset2 < s2.length)) {
            if (s1.charAt(c + offset1) === s2.charAt(c + offset2)) {
                lcs++;
            } else {
                offset1 = 0;
                offset2 = 0;
                for (let i = 0; i < maxOffset; i++) {
                    if ((c + i < s1.length) && (s1.charAt(c + i) === s2.charAt(c))) {
                        offset1 = i;
                        break;
                    }
                    if ((c + i < s2.length) && (s1.charAt(c) === s2.charAt(c + i))) {
                        offset2 = i;
                        break;
                    }
                }
            }
            c++;
        }
        return (s1.length + s2.length) / 2 - lcs;
    }

    _searchBKTree(queryWord, maxDistance) {
        const results = [];
        if (!this.bkTree) return results;
        const candidates = [this.bkTree];

        while (candidates.length > 0) {
            const node = candidates.shift();
            const distance = this._sift3Distance(node.word, queryWord);

            if (distance <= maxDistance) {
                results.push({ word: node.word, distance, frequency: node.frequency });
            }

            const searchMin = distance - maxDistance;
            const searchMax = distance + maxDistance;

            for (const [dist, childNode] of node.children.entries()) {
                if (dist >= searchMin && dist <= searchMax) {
                    candidates.push(childNode);
                }
            }
        }
        return results;
    }

    getCorrections(word) {
        const lowerCaseWord = word.toLowerCase();

        if (this.cache.has(lowerCaseWord)) {
            return this.cache.get(lowerCaseWord);
        }

        if (this.dictionary.has(lowerCaseWord)) {
            return [{ word: word, distance: 0, confidence: 1.0 }];
        }

        const candidates = this._searchBKTree(lowerCaseWord, this.config.maxEditDistance);

        const rankedResults = candidates
            .map(candidate => {
                const freqScore = Math.log1p(candidate.frequency) / Math.log1p(this.maxFrequency);
                const distScore = 1 - (candidate.distance / Math.max(lowerCaseWord.length, candidate.word.length));
                const confidence = 0.7 * freqScore + 0.3 * distScore;
                return { ...candidate, confidence };
            })
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 5);

        if (this.cache.size >= this.config.cacheSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        this.cache.set(lowerCaseWord, rankedResults);

        return rankedResults;
    }
}


/**
 * Manages the console interface, user input, and formatted output.
 */
class ConsoleInterface {
    constructor() {
        this.engine = new AutoCorrectEngine();
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: chalk.cyan('> '),
        });

        this._setupEventListeners();
    }

    _setupEventListeners() {
        this.engine.on('dictionary-loaded', ({ wordCount }) => {
            console.log(chalk.gray(`📚 Dictionary loaded with ${wordCount} words.`));
        });

        this.engine.on('bk-tree-built', ({ nodeCount }) => {
            console.log(chalk.gray(`🌳 BK-Tree built with ${nodeCount} nodes.`));
        });

        this.rl.on('line', (line) => this._processLine(line.trim()));
        this.rl.on('close', () => {
            console.log(chalk.yellow('\nGoodbye!'));
            process.exit(0);
        });
    }

    _processLine(line) {
        if (!line) {
            this.rl.prompt();
            return;
        }

        if (line.startsWith('/')) {
            this._handleCommand(line);
        } else {
            const words = line.split(/\s+/);
            let output = '';
            words.forEach(word => {
                const corrections = this.engine.getCorrections(word);
                if (corrections.length > 0 && corrections[0].distance > 0) {
                    const topSuggestion = corrections[0].word;
                    output += `${chalk.red(word)}→${chalk.green(topSuggestion)} `;
                } else {
                    output += `${word} `;
                }
            });
            console.log(output.trim());
        }
        this.rl.prompt();
    }

    _handleCommand(line) {
        const [command, ...args] = line.slice(1).split(' ');
        switch (command.toLowerCase()) {
            case 'help':
                this._showHelp();
                break;
            case 'check':
                if (!args[0]) {
                    console.log(chalk.yellow('Usage: /check <word>'));
                    break;
                }
                const corrections = this.engine.getCorrections(args[0]);
                console.log(chalk.bold(`Suggestions for "${args[0]}":`));
                if (corrections.length > 0 && corrections[0].distance > 0) {
                    corrections.forEach(c => {
                        console.log(`  - ${chalk.green(c.word)} (confidence: ${c.confidence.toFixed(2)}, dist: ${c.distance})`);
                    });
                } else {
                    console.log(chalk.gray('  No suggestions found or word is correct.'));
                }
                break;
            case 'stats':
                this._showStats();
                break;
            case 'clear':
                console.clear();
                break;
            case 'exit':
                this.rl.close();
                break;
            default:
                console.log(chalk.red(`Unknown command: "${command}"`));
        }
    }

    _showHelp() {
        console.log(chalk.bold.yellow('\nAutoCorrect Help:'));
        console.log(`
  Type any text to get instant corrections.
  
  ${chalk.cyan('/help')}          Show this help message.
  ${chalk.cyan('/check <word>')}  Get a detailed list of suggestions for a word.
  ${chalk.cyan('/stats')}         Display engine statistics.
  ${chalk.cyan('/clear')}         Clear the console screen.
  ${chalk.cyan('/exit')}          Exit the application.
        `);
    }

    _showStats() {
        console.log(chalk.bold.yellow('\nEngine Statistics:'));
        console.log(`
  - Dictionary Size: ${this.engine.dictionary.size} words
  - Max Edit Distance: ${this.engine.config.maxEditDistance}
  - Cache Size:        ${this.engine.cache.size} / ${this.engine.config.cacheSize}
        `);
    }

    start() {
        console.log(chalk.bold.green('🚀 Console AutoCorrect Engine Started'));
        console.log(chalk.gray('Type text for suggestions or /help for commands.\n'));
        this.rl.prompt();
    }
}

// --- Application Entry Point ---
const app = new ConsoleInterface();
app.start();
