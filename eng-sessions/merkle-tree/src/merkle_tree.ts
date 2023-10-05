import { LevelUp, LevelUpChain } from 'levelup';
import { HashPath } from './hash_path';
import { Sha256Hasher } from './sha256_hasher';

const MAX_DEPTH = 32;
const LEAF_BYTES = 64; // All leaf values are 64 bytes.

/**
 * The merkle tree, in summary, is a data structure with a number of indexable elements, and the property
 * that it is possible to provide a succinct proof (HashPath) that a given piece of data, exists at a certain index,
 * for a given merkle tree root.
 */
export class MerkleTree {
  private hasher = new Sha256Hasher();
  private root = Buffer.alloc(32);

  /**
   * Constructs a new MerkleTree instance, either initializing an empty tree, or restoring pre-existing state values.
   * Use the async static `new` function to construct.
   *
   * @param db Underlying leveldb.
   * @param name Name of the tree, to be used when restoring/persisting state.
   * @param depth The depth of the tree, to be no greater than MAX_DEPTH.
   * @param root When restoring, you need to provide the root.
   */
  constructor(private db: LevelUp, private name: string, private depth: number, root?: Buffer) {
    if (!(depth >= 1 && depth <= MAX_DEPTH)) {
      throw Error('Bad depth');
    }

    // Implement.
    if (!root) {
      let node = this.hasher.hash(Buffer.alloc(LEAF_BYTES));
      for (let i = 0; i < depth; i++) {
        const parent = this.hasher.compress(node, node);
        db.put(parent, Buffer.concat([node, node]));
        node = parent;
      }
      this.root = node;
    } else {
      this.root = root;
    }
  }

  /**
   * Constructs or restores a new MerkleTree instance with the given `name` and `depth`.
   * The `db` contains the tree data.
   */
  static async new(db: LevelUp, name: string, depth = MAX_DEPTH) {
    const meta: Buffer = await db.get(Buffer.from(name)).catch(() => {});
    if (meta) {
      const root = meta.slice(0, 32);
      const depth = meta.readUInt32LE(32);
      return new MerkleTree(db, name, depth, root);
    } else {
      const tree = new MerkleTree(db, name, depth);
      await tree.writeMetaData();
      return tree;
    }
  }

  private async writeMetaData(batch?: LevelUpChain<string, Buffer>) {
    const data = Buffer.alloc(40);
    this.root.copy(data);
    data.writeUInt32LE(this.depth, 32);
    if (batch) {
      batch.put(this.name, data);
    } else {
      await this.db.put(this.name, data);
    }
  }

  getRoot() {
    return this.root;
  }

  /**
   * Returns the hash path for `index`.
   * e.g. To return the HashPath for index 2, return the nodes marked `*` at each layer.
   *     d0:                                            [ root ]
   *     d1:                      [*]0                                               [*]
   *     d2:         [*]0                      [*]1                       [ ]                     [ ]
   *
   *
   *
   *     d3:   [ ]0         [ ]1          [*]0         [*]1           [ ]         [ ]          [ ]        [ ]
   *           0(000)         1(001)       2(010)        3(011)
   */

  // d1, index: 3,  011 -> 01 -> "1" true (right)
  async getHashPath(index: number) {
    // Implement.
    const hashPath = new HashPath();
    let nodes = (await this.db.get(this.root)) as Buffer;
    console.log(this.root.toString('hex'));
    for (let i = this.depth - 1; i >= 0; i--) {
      const left = nodes.slice(0, 32);
      const right = nodes.slice(32, 64);

      hashPath.data[i] = [left, right];
      if (i !== 0) {
        const isRight = this.isRight(index, i);
        console.log(`isRight: ${isRight}, node: ${isRight ? right.toString('hex') : left.toString('hex')}`);
        nodes = await this.db.get(isRight ? right : left);
      }
    }
    console.log(hashPath.data.map(h => [h[0].toString('hex'), h[1].toString('hex')]));
    return hashPath;
  }

  /**
   * Updates the tree with `value` at `index`. Returns the new tree root.
   */
  async updateElement(index: number, value: Buffer) {
    // Implement.

    this.root = await this._updateElement(index, this.root, 0, value);

    return this.root;
  }

  async _updateElement(index: number, parent: Buffer, currentDepth: number, value: Buffer) {
    if (currentDepth === this.depth) {
      return this.hasher.hash(value);
    }
    // console.log(currentDepth, parent.toString('hex'));
    const nodes = (await this.db.get(parent)) as Buffer;
    let left = nodes.slice(0, 32);
    let right = nodes.slice(32, 64);
    const isRight = this.isRight(index, currentDepth);
    const latestNode = await this._updateElement(index, isRight ? right : left, currentDepth + 1, value);

    if (isRight) {
      right = latestNode;
    } else {
      left = latestNode;
    }

    const latestParent = this.hasher.compress(left, right);
    console.log(`latestParent ${latestParent.toString('hex')}`);
    await this.db.put(latestParent, Buffer.concat([left, right]));

    return latestParent;
  }

  private isRight(index: number, currentDepth: number) {
    return !!((index >> (this.depth - currentDepth - 1)) & 1);
  }
}
