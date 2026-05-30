import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * StagingDeployer: Deploy artifacts to staging environment
 * Supports: Docker, Kubernetes, AWS ECS, Heroku, custom scripts
 */
export class StagingDeployer {
  private outputChannel: vscode.OutputChannel;
  private stagingConfig: StagingConfig;

  constructor(outputChannel: vscode.OutputChannel, stagingConfig?: StagingConfig) {
    this.outputChannel = outputChannel;
    this.stagingConfig = stagingConfig || this.loadDefaultConfig();
  }

  /**
   * Deploy artifact to staging environment
   */
  async deploy(artifactPath: string, version: string): Promise<DeploymentResult> {
    this.outputChannel.appendLine(`\n📦 [StagingDeployer] Starting deployment to staging...`);
    this.outputChannel.appendLine(`   Artifact: ${artifactPath}`);
    this.outputChannel.appendLine(`   Version: ${version}`);

    try {
      // Validate artifact exists
      if (!fs.existsSync(artifactPath)) {
        throw new Error(`Artifact not found: ${artifactPath}`);
      }

      // Determine deployment strategy
      const strategy = this.determineStrategy();
      this.outputChannel.appendLine(`   Strategy: ${strategy}`);

      let result: DeploymentResult;

      switch (strategy) {
        case 'docker':
          result = await this.deployDocker(artifactPath, version);
          break;
        case 'kubernetes':
          result = await this.deployKubernetes(artifactPath, version);
          break;
        case 'ecs':
          result = await this.deployECS(artifactPath, version);
          break;
        case 'heroku':
          result = await this.deployHeroku(artifactPath, version);
          break;
        case 'custom':
          result = await this.deployCustom(artifactPath, version);
          break;
        default:
          throw new Error(`Unknown deployment strategy: ${strategy}`);
      }

      this.outputChannel.appendLine(`✅ Deployment to staging completed successfully`);
      return result;
    } catch (error) {
      this.outputChannel.appendLine(`❌ Deployment failed: ${error}`);
      throw error;
    }
  }

  /**
   * Deploy using Docker
   */
  private async deployDocker(artifactPath: string, version: string): Promise<DeploymentResult> {
    this.outputChannel.appendLine(`   🐳 Deploying via Docker...`);

    const imageName = `${this.stagingConfig.dockerRegistry}/${this.stagingConfig.appName}:${version}`;
    const containerName = `${this.stagingConfig.appName}-staging-${version}`;

    try {
      // Build Docker image
      this.outputChannel.appendLine(`   Building Docker image: ${imageName}`);
      await execAsync(`docker build -t ${imageName} -f ${artifactPath}/Dockerfile ${artifactPath}`);

      // Stop existing container
      try {
        await execAsync(`docker stop ${containerName}`);
        await execAsync(`docker rm ${containerName}`);
      } catch {
        // Container might not exist, ignore
      }

      // Run new container
      this.outputChannel.appendLine(`   Starting container: ${containerName}`);
      const portMapping = this.stagingConfig.stagingPort ? `-p ${this.stagingConfig.stagingPort}:${this.stagingConfig.appPort}` : '';
      await execAsync(`docker run -d --name ${containerName} ${portMapping} ${imageName}`);

      // Get container IP
      const { stdout } = await execAsync(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${containerName}`);
      const containerIP = stdout.trim();

      return {
        success: true,
        deploymentId: containerName,
        environment: 'staging',
        url: `http://${containerIP}:${this.stagingConfig.appPort}`,
        timestamp: new Date().toISOString(),
        strategy: 'docker',
      };
    } catch (error) {
      throw new Error(`Docker deployment failed: ${error}`);
    }
  }

  /**
   * Deploy using Kubernetes
   */
  private async deployKubernetes(artifactPath: string, version: string): Promise<DeploymentResult> {
    this.outputChannel.appendLine(`   ☸️  Deploying via Kubernetes...`);

    try {
      // Update image in deployment manifest
      const manifestPath = path.join(artifactPath, 'k8s-deployment.yaml');
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`Kubernetes manifest not found: ${manifestPath}`);
      }

      // Apply deployment
      this.outputChannel.appendLine(`   Applying Kubernetes manifest...`);
      await execAsync(`kubectl apply -f ${manifestPath}`);

      // Wait for rollout
      this.outputChannel.appendLine(`   Waiting for rollout...`);
      await execAsync(`kubectl rollout status deployment/${this.stagingConfig.appName}-staging -n ${this.stagingConfig.kubeNamespace}`);

      // Get service URL
      const { stdout } = await execAsync(`kubectl get service ${this.stagingConfig.appName}-staging -n ${this.stagingConfig.kubeNamespace} -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'`);
      const serviceURL = stdout.trim();

      return {
        success: true,
        deploymentId: `${this.stagingConfig.appName}-staging-${version}`,
        environment: 'staging',
        url: `http://${serviceURL}`,
        timestamp: new Date().toISOString(),
        strategy: 'kubernetes',
      };
    } catch (error) {
      throw new Error(`Kubernetes deployment failed: ${error}`);
    }
  }

  /**
   * Deploy using AWS ECS
   */
  private async deployECS(artifactPath: string, version: string): Promise<DeploymentResult> {
    this.outputChannel.appendLine(`   ☁️  Deploying via AWS ECS...`);

    try {
      // Update ECS task definition
      const taskDefPath = path.join(artifactPath, 'ecs-task-definition.json');
      if (!fs.existsSync(taskDefPath)) {
        throw new Error(`ECS task definition not found: ${taskDefPath}`);
      }

      // Register new task definition
      this.outputChannel.appendLine(`   Registering ECS task definition...`);
      const { stdout } = await execAsync(`aws ecs register-task-definition --cli-input-json file://${taskDefPath}`);
      const taskDef = JSON.parse(stdout);
      const taskDefArn = taskDef.taskDefinition.taskDefinitionArn;

      // Update service
      this.outputChannel.appendLine(`   Updating ECS service...`);
      await execAsync(`aws ecs update-service --cluster ${this.stagingConfig.ecsCluster} --service ${this.stagingConfig.appName}-staging --task-definition ${taskDefArn}`);

      return {
        success: true,
        deploymentId: taskDefArn,
        environment: 'staging',
        url: `https://${this.stagingConfig.stagingDomain}`,
        timestamp: new Date().toISOString(),
        strategy: 'ecs',
      };
    } catch (error) {
      throw new Error(`ECS deployment failed: ${error}`);
    }
  }

  /**
   * Deploy using Heroku
   */
  private async deployHeroku(artifactPath: string, version: string): Promise<DeploymentResult> {
    this.outputChannel.appendLine(`    🚀 Deploying via Heroku...`);

    try {
      // Push to Heroku
      this.outputChannel.appendLine(`   Pushing to Heroku...`);
      await execAsync(`git push heroku staging:main`, { cwd: artifactPath });

      return {
        success: true,
        deploymentId: `${this.stagingConfig.appName}-staging`,
        environment: 'staging',
        url: `https://${this.stagingConfig.appName}-staging.herokuapp.com`,
        timestamp: new Date().toISOString(),
        strategy: 'heroku',
      };
    } catch (error) {
      throw new Error(`Heroku deployment failed: ${error}`);
    }
  }

  /**
   * Deploy using custom script
   */
  private async deployCustom(artifactPath: string, version: string): Promise<DeploymentResult> {
    this.outputChannel.appendLine(`   🔧 Deploying via custom script...`);

    try {
      const scriptPath = path.join(artifactPath, this.stagingConfig.customDeployScript || 'deploy-staging.sh');
      if (!fs.existsSync(scriptPath)) {
        throw new Error(`Custom deploy script not found: ${scriptPath}`);
      }

      this.outputChannel.appendLine(`   Running custom script: ${scriptPath}`);
      const { stdout } = await execAsync(`bash ${scriptPath} ${version}`);
      this.outputChannel.appendLine(`   Script output: ${stdout}`);

      return {
        success: true,
        deploymentId: `custom-${version}`,
        environment: 'staging',
        url: this.stagingConfig.stagingDomain || 'http://localhost:3000',
        timestamp: new Date().toISOString(),
        strategy: 'custom',
      };
    } catch (error) {
      throw new Error(`Custom deployment failed: ${error}`);
    }
  }

  /**
   * Determine deployment strategy based on config
   */
  private determineStrategy(): DeploymentStrategy {
    if (this.stagingConfig.deploymentStrategy) {
      return this.stagingConfig.deploymentStrategy;
    }

    // Auto-detect based on available tools
    if (fs.existsSync('Dockerfile')) return 'docker';
    if (fs.existsSync('k8s-deployment.yaml')) return 'kubernetes';
    if (fs.existsSync('ecs-task-definition.json')) return 'ecs';
    if (fs.existsSync('Procfile')) return 'heroku';

    return 'custom';
  }

  /**
   * Load default staging configuration
   */
  private loadDefaultConfig(): StagingConfig {
    return {
      appName: 'safegraph-ai',
      stagingPort: 3000,
      appPort: 3000,
      dockerRegistry: 'docker.io',
      kubeNamespace: 'staging',
      ecsCluster: 'staging',
      stagingDomain: 'staging.safegraph.ai',
      deploymentStrategy: 'docker',
    };
  }
}

export interface StagingConfig {
  appName: string;
  stagingPort?: number;
  appPort?: number;
  dockerRegistry?: string;
  kubeNamespace?: string;
  ecsCluster?: string;
  stagingDomain?: string;
  deploymentStrategy?: DeploymentStrategy;
  customDeployScript?: string;
}

export type DeploymentStrategy = 'docker' | 'kubernetes' | 'ecs' | 'heroku' | 'custom';

export interface DeploymentResult {
  success: boolean;
  deploymentId: string;
  environment: string;
  url: string;
  timestamp: string;
  strategy: DeploymentStrategy;
}
