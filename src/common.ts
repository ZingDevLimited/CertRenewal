import * as cp from "child_process";

export const pauseAsync = (pauseInSeconds: number): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (pauseInSeconds <= 0) {
            reject(new Error("invalid argument. pauseInSeconds must be > 0"));
        }
        setTimeout(() => {
            resolve();
        }, (pauseInSeconds * 1000));
    });
};

interface IRunCmdAsyncResult {
    errorMessage: string;
    exitCode: number;
    stderr: string;
    stdout: string;
    success: boolean;
}

export const runCmdAsync = (cmd: string): Promise<IRunCmdAsyncResult> => {
    return new Promise((resolve) => {
        cp.exec(cmd, (error, stdout, stderr) => {
            resolve({
                errorMessage: error ? error.message : "",
                exitCode: error ? error.code || -1 : 0,
                stderr,
                stdout,
                success: (error === null || error === undefined),
            });
        });
    });
};
