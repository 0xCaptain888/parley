// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IReturnDataParley {
    function claimPacket(uint256 id, bytes32 pubKey) external;
    function withdraw() external;
}

contract ReturnDataWallet {
    uint256 public size;
    bool public reject;

    function configure(uint256 length, bool shouldRevert) external {
        size = length;
        reject = shouldRevert;
    }

    function claim(address parley, uint256 id) external {
        IReturnDataParley(parley).claimPacket(id, bytes32(uint256(1)));
    }

    function pull(address parley) external {
        IReturnDataParley(parley).withdraw();
    }

    receive() external payable {
        uint256 length = size;
        bool shouldRevert = reject;
        assembly {
            mstore(0, 0)
            if shouldRevert { revert(0, length) }
            return(0, length)
        }
    }
}
