import OpenAI from 'openai';
import inquirer from 'inquirer';
import chalk from 'chalk';
import debug from 'debug';

const openai = new OpenAI();
const ASSISTANT_ID = 'asst_JeSpGEvms6Mpup5NFhG4lnrm';

const aiDebug = debug('openai');
const apiDebug = debug('widget api');

const WIDGET_PATH =
  '/Users/felix/Library/Application Support/Übersicht/widgets';

const widgetAPI = {
  addWidget: async ({body}) => {
    apiDebug('adding widget:\n%s', body);
    return 'new-widget';
  },

  updateWidget: async ({id, body}) => {
    apiDebug('updating widget', id);
    return true;
  },
};

async function main() {
  const assistant = await openai.beta.assistants.retrieve(ASSISTANT_ID);
  let thread = await openai.beta.threads.create();
  const context = {thread, assistant};

  const handleError = (err) => {
    console.error(err);
    process.exit(1);
  };

  process.on('beforeExit', async () => {
    if (thread) {
      await openai.beta.threads.del(thread.id);
      thread = undefined;
      console.log('Good bye!');
    }
  });
  process.on('unhandledRejection', handleError);
  process.on('uncaughtException', handleError);

  while (true) {
    const answer = await inquirer.prompt({
      type: 'input',
      name: 'userInput',
      message: 'ü>',
    });
    const run = await sendMessage(context, answer.userInput);
    const messages = await completeRun(run);

    messages.data[0].content.forEach((content) => {
      content.type === 'text'
        ? console.log(chalk.magenta(content.text.value))
        : console.log(content);
    });
  }
}

async function sendMessage({thread, assistant}, content) {
  await openai.beta.threads.messages.create(thread.id, {
    role: 'user',
    content,
  });
  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistant.id,
  });
  return run;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function completeRun({id, thread_id}) {
  let runHalted = false;

  while (!runHalted) {
    const run = await openai.beta.threads.runs.retrieve(thread_id, id);
    aiDebug('got run ' + run.status);
    switch (run.status) {
      case 'queued':
      case 'in_progress':
      case 'cancelling':
        runHalted = false;
        break;
      case 'requires_action':
        runHalted = false;
        await performAction(run, widgetAPI);
        break;
      case 'cancelled':
      case 'failed':
      case 'completed':
      case 'expired':
        runHalted = true;
        break;
      default:
        runHalted = true;
    }
    if (!runHalted) await sleep(1000);
  }

  return openai.beta.threads.messages.list(thread_id);
}

async function performAction(run, actions) {
  if (run.required_action.type !== 'submit_tool_outputs') {
    throw new Error(
      "Don't know how to perform action " + run.required_action.type,
    );
  }
  const {tool_calls} = run.required_action.submit_tool_outputs;

  const outputs = await Promise.all(
    tool_calls.map((call) => {
      return new Promise((resolve, reject) => {
        aiDebug('performing action %O', call);
        const {name} = call.function;
        if (!actions[name]) {
          return reject(new Error('Unknown function ' + name));
        }

        let args;
        try {
          args = JSON.parse(call.function.arguments);
        } catch (err) {
          reject(error);
        }

        actions[name](args).then((output) =>
          resolve({tool_call_id: call.id, output}),
        );
      });
    }),
  );

  await openai.beta.threads.runs.submitToolOutputs(run.thread_id, run.id, {
    tool_outputs: outputs,
  });
}

main();
