import { Region, Resolver, SchemaInfo, SystemEnvironment, ProjectInfo } from '../types'
import figures = require('figures')
import generateName = require('sillyname')
import cloneCommand from './clone'
import { createProject, parseErrors, generateErrorOutput } from '../api/api'
import * as fs from 'fs'
import * as path from 'path'
import { projectInfoToContents } from '../utils/utils'
import {writeProjectFile, isValidSchemaFilePath, writeBlankProjectFileWithInfo} from '../utils/file'
import 'isomorphic-fetch'
import {
  graphcoolProjectFileName,
  creatingProjectMessage,
  createdProjectMessage,
  couldNotCreateProjectMessage,
  projectAlreadyExistsMessage,
  projectFileSuffix,
  sampleSchemaURL, invalidSchemaFileMessage
} from '../utils/constants'
const debug = require('debug')('graphcool')

interface Props {
  copyProjectId?: string // only used for copy
  projectFile?: string // only used for copy
  copyOptions?: string // only used for copy
  schemaUrl?: string
  name?: string
  alias?: string
  region?: Region
  outputPath?: string
}

export default async (props: Props, env: SystemEnvironment): Promise<void> => {

  const {resolver, out} = env

  if (props.copyProjectId) {
    // clone
    const includes = props.copyOptions || 'all'
    const includeMutationCallbacks = includes === 'all' || includes === 'mutation-callbacks'
    const includeData = includes === 'all' || includes === 'data'
    const cloneProps = {
      sourceProjectId: props.copyProjectId,
      projectFile: props.projectFile,
      outputPath: props.outputPath,
      name: props.name,
      includeData,
      includeMutationCallbacks
    }
    await cloneCommand(cloneProps, env)

  } else {
    // create new
    const projectFiles = resolver.projectFiles('.')
    if (projectFiles.length > 0 && !props.outputPath) {
      throw new Error(projectAlreadyExistsMessage(projectFiles))
    }

    const name = props.name || generateName()
    out.startSpinner(creatingProjectMessage(name))

    try {
      // resolve schema
      const schemaUrl = props.schemaUrl
      if (!isValidSchemaFilePath(schemaUrl)) {
        throw new Error(invalidSchemaFileMessage(schemaUrl!))
      }
      const schema = await getSchema(schemaUrl, resolver)

      // create project
      const projectInfo = await createProjectAndGetProjectInfo(name, schema, resolver, props.alias, props.region)
      if (!isBlankProject(props)) {
        writeProjectFile(projectInfo, resolver, props.outputPath)
      } else {
        writeBlankProjectFileWithInfo(projectInfo, resolver, props.outputPath)
      }

      out.stopSpinner()

      const message = createdProjectMessage(name, projectInfo.projectId, projectInfoToContents(projectInfo))
      out.write(message)

    } catch (e) {
      out.stopSpinner()
      out.writeError(`${couldNotCreateProjectMessage}`)

      if (e.errors) {
        const errors = parseErrors(e)
        const output = generateErrorOutput(errors)
        out.writeError(`${output}`)
      } else {
        throw e
      }
    }
  }

}

function isBlankProject(props: Props) {
  return props.schemaUrl === sampleSchemaURL
}

async function createProjectAndGetProjectInfo(name: string, schema: SchemaInfo, resolver: Resolver, alias?: string, region?: string): Promise<ProjectInfo> {
  const projectInfo = await createProject(name, schema.schema, resolver, alias, region)
  if (schema.source === sampleSchemaURL) {
    projectInfo.schema = `${projectInfo.schema}\n\n# type Tweet {\n#   text: String!\n# }`
  }
  return projectInfo
}

async function getSchema(schemaUrl: string | undefined, resolver: Resolver): Promise<SchemaInfo> {
  if (schemaUrl) {
    if (schemaUrl.startsWith('http')) {
      const response = await fetch(schemaUrl)
      const schema = await response.text()
      return {
        schema,
        source: schemaUrl,
      }
    } else {
      return {
        schema: resolver.read(schemaUrl),
        source: schemaUrl,
      }
    }
  } else {
    const schemaFiles = resolver.readDirectory('.').filter(f => f.endsWith(projectFileSuffix))
    if (schemaFiles.length === 0) {
      throw new Error(`No ${projectFileSuffix} file found or specified`)
    }

    const file = schemaFiles.find(f => f === graphcoolProjectFileName) || schemaFiles[0]
    return {
      schema: fs.readFileSync(path.resolve(file)).toString(),
      source: schemaFiles[0],
    }
  }
}

